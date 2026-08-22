-- Restoring a cancelled booking has to undo the refund the cancellation made.
--
-- bookings_return_account_credit_on_cancel hands back the account credit a
-- booking consumed, as a fresh open credit tied to that booking. It had no
-- inverse. So an admin who cancels a booking and later un-cancels it left BOTH
-- on the row: the original 'account_credit' payment (still counted as paid) and
-- the credit that refunded it (still counted as an offset). The same money,
-- twice.
--
-- Seen in production: a booking read "Owed 3,100 / Paid 6,700 / Balance 7,200
-- credit" after a cancel on Aug 20 and a restore on Aug 22. The true figure was
-- 3,600 -- an ordinary overpayment -- and the diver's account credit was
-- inflated by the other 3,600 as well.
--
-- On cancelled -> anything else, take the returned money back, because it is
-- once again applied to the booking:
--
--   * whatever is still OPEN is settled -- the diver keeps nothing, since the
--     credit backs this booking again;
--   * whatever was already SPENT elsewhere cannot be clawed back from the
--     booking it went to, so this booking's account-credit payment is reduced
--     by that much with an offsetting 'refunded' row.
--
-- Both halves are recorded rather than silently adjusted, so the Audits feed
-- shows the round trip.

-- A reclaimed refund must stop looking like a live one, or the pair of triggers
-- disagrees about state and a cancel -> restore -> cancel -> restore cycle both
-- fails to re-issue the refund AND fabricates a second one. 'return_reclaimed'
-- is that terminal marker: it is deliberately NOT one of the sources that mean
-- "this booking's money is currently given back", so the next cancellation
-- issues a fresh refund exactly as the first one did.
ALTER TABLE "public"."credits" DROP CONSTRAINT IF EXISTS "credits_source_check";

ALTER TABLE "public"."credits"
  ADD CONSTRAINT "credits_source_check" CHECK ("source" = ANY (ARRAY[
    'manual'::"text",
    'event_cancellation'::"text",
    'booking_cancellation_return'::"text",
    'carry_forward'::"text",
    'return_reclaimed'::"text"
  ]));

CREATE OR REPLACE FUNCTION "public"."bookings_reclaim_returned_credit_on_restore"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_returned  numeric;
  v_reclaim   numeric;
  v_take      numeric;
  v_spent     numeric;
  v_currency  text;
  c           record;
begin
  if new.user_id is null then
    return new;
  end if;

  -- What this booking's cancellation handed back and has not been reclaimed
  -- yet. A partial spend settles the original row in full and carries the
  -- remainder into a 'carry_forward' child, so summing the original source
  -- stays stable across spends.
  select coalesce(sum(amount), 0) into v_returned
    from public.credits
   where booking_id = new.id
     and source = 'booking_cancellation_return';

  if v_returned <= 0 then
    return new;
  end if;

  -- Reclaim from what is still open on this booking, oldest first. A
  -- carry_forward row tied to this booking is the unspent tail of that same
  -- refund, so it counts too.
  v_reclaim := v_returned;
  for c in
    select id, amount, currency, reason, created_by, booking_id
      from public.credits
     where booking_id = new.id
       and status = 'open'
       and source in ('booking_cancellation_return', 'carry_forward')
     order by created_at asc, id asc
  loop
    exit when v_reclaim <= 0;
    v_take := least(c.amount, v_reclaim);

    if v_take >= c.amount then
      update public.credits
         set status       = 'settled',
             source       = 'return_reclaimed',
             settled_at   = now(),
             settled_note = 'Booking restored; credit re-applied to booking ' || new.id
       where id = c.id;
    else
      -- Only part of this row belongs to the refund being reclaimed. Settle it
      -- and hand the rest straight back, so unrelated credit is never consumed.
      update public.credits
         set status       = 'settled',
             source       = 'return_reclaimed',
             settled_at   = now(),
             settled_note = 'Booking restored; ' || c.currency || ' ' || v_take
                            || ' re-applied to booking ' || new.id
                            || '; ' || c.currency || ' ' || (c.amount - v_take)
                            || ' carried forward'
       where id = c.id;

      insert into public.credits (user_id, booking_id, amount, currency, reason, status, created_by, source)
      values (new.user_id, c.booking_id, c.amount - v_take, c.currency, c.reason, 'open', c.created_by, 'carry_forward');
    end if;

    v_reclaim := v_reclaim - v_take;
  end loop;

  -- Anything we could not reclaim was already spent on another booking. That
  -- money is gone from this one, so its account-credit payment no longer backs
  -- it in full.
  v_spent := v_reclaim;
  if v_spent > 0 then
    select max(currency) into v_currency
      from public.payments
     where booking_id = new.id and method = 'account_credit';

    insert into public.payments (user_id, booking_id, amount, currency, status, method, note, recorded_by)
    values (
      new.user_id, new.id, v_spent, coalesce(v_currency, 'TWD'),
      'refunded', 'account_credit',
      'Returned credit already spent elsewhere before this booking was restored',
      auth.uid()
    );
  end if;

  -- Retire the refund itself, including rows already settled by a spend. Left
  -- as 'booking_cancellation_return' they would still read as "this booking's
  -- money is given back", which would both suppress the next cancellation's
  -- refund and make the next restore reclaim the same money again.
  update public.credits
     set source = 'return_reclaimed'
   where booking_id = new.id
     and source = 'booking_cancellation_return';

  return new;
end;
$$;

ALTER FUNCTION "public"."bookings_reclaim_returned_credit_on_restore"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "trg_bookings_reclaim_returned_credit_on_restore" ON "public"."bookings";

CREATE TRIGGER "trg_bookings_reclaim_returned_credit_on_restore"
  AFTER UPDATE OF "status" ON "public"."bookings"
  FOR EACH ROW
  WHEN (OLD."status" = 'cancelled' AND NEW."status" IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION "public"."bookings_reclaim_returned_credit_on_restore"();
