-- One-time repair for bookings that were cancelled and then restored BEFORE
-- trg_bookings_reclaim_returned_credit_on_restore existed.
--
-- Those restores left the refund in place: the booking carries both its
-- original 'account_credit' payment and the credit that returned it, so its
-- balance and the diver's account credit both double-count the same money.
-- Production had exactly one (a booking cancelled 2026-08-20, restored
-- 2026-08-22, reading "Owed 3,100 / Paid 6,700 / Balance 7,200 credit" when
-- the true figure was 3,600).
--
-- Rather than hardcode that row, this reclaims every stranded return: an OPEN
-- 'booking_cancellation_return' credit whose booking is no longer cancelled.
-- The set is empty on a fresh database, so the migration is a no-op for forks
-- and for any deployment the trigger has always covered.
--
-- The reclaim logic is lifted out of the trigger into a callable function so
-- the repair and the trigger cannot drift: the trigger now delegates to it.

CREATE OR REPLACE FUNCTION "public"."reclaim_returned_credit"("p_booking_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql"
    SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user      uuid;
  v_returned  numeric;
  v_reclaim   numeric;
  v_take      numeric;
  v_spent     numeric;
  v_currency  text;
  c           record;
begin
  select user_id into v_user from public.bookings where id = p_booking_id;
  if v_user is null then
    return 0;
  end if;

  -- What this booking's cancellation handed back and has not been reclaimed
  -- yet. A partial spend settles the original row in full and carries the
  -- remainder into a 'carry_forward' child, so summing the original source
  -- stays stable across spends.
  select coalesce(sum(amount), 0) into v_returned
    from public.credits
   where booking_id = p_booking_id
     and source = 'booking_cancellation_return';

  if v_returned <= 0 then
    return 0;
  end if;

  -- Reclaim from what is still open on this booking, oldest first. A
  -- carry_forward row tied to this booking is the unspent tail of that same
  -- refund, so it counts too.
  v_reclaim := v_returned;
  for c in
    select id, amount, currency, reason, created_by, booking_id
      from public.credits
     where booking_id = p_booking_id
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
             settled_note = 'Booking restored; credit re-applied to booking ' || p_booking_id
       where id = c.id;
    else
      -- Only part of this row belongs to the refund being reclaimed. Settle it
      -- and hand the rest straight back, so unrelated credit is never consumed.
      update public.credits
         set status       = 'settled',
             source       = 'return_reclaimed',
             settled_at   = now(),
             settled_note = 'Booking restored; ' || c.currency || ' ' || v_take
                            || ' re-applied to booking ' || p_booking_id
                            || '; ' || c.currency || ' ' || (c.amount - v_take)
                            || ' carried forward'
       where id = c.id;

      insert into public.credits (user_id, booking_id, amount, currency, reason, status, created_by, source)
      values (v_user, c.booking_id, c.amount - v_take, c.currency, c.reason, 'open', c.created_by, 'carry_forward');
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
     where booking_id = p_booking_id and method = 'account_credit';

    insert into public.payments (user_id, booking_id, amount, currency, status, method, note, recorded_by)
    values (
      v_user, p_booking_id, v_spent, coalesce(v_currency, 'TWD'),
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
   where booking_id = p_booking_id
     and source = 'booking_cancellation_return';

  return v_returned;
end;
$$;

ALTER FUNCTION "public"."reclaim_returned_credit"("uuid") OWNER TO "postgres";

-- Internal only: SECURITY DEFINER with no ownership check, so exposing it would
-- let any caller rewrite another diver's credits.
REVOKE ALL ON FUNCTION "public"."reclaim_returned_credit"("uuid") FROM PUBLIC, "anon", "authenticated";

-- The trigger is now a thin wrapper, so restore-time and repair-time behavior
-- are the same code.
CREATE OR REPLACE FUNCTION "public"."bookings_reclaim_returned_credit_on_restore"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.user_id is not null then
    perform public.reclaim_returned_credit(new.id);
  end if;
  return new;
end;
$$;

-- The repair itself, in two deliberately separate steps.
--
-- Step A moves money, so it is confined to the unambiguous case: a refund that
-- is still OPEN on a booking that is no longer cancelled. Nothing was spent,
-- so reclaiming it is arithmetic, not judgement.
--
-- Step B moves NO money. A refund on a live booking that an admin already
-- settled by hand leaves a stale marker: the row still reads
-- 'booking_cancellation_return', so the next cancellation of that booking
-- would think the money had already been given back and skip refunding it.
-- Retiring the marker fixes that without touching a single amount. It is
-- deliberately not routed through reclaim_returned_credit(), because a settled
-- row is ambiguous -- spent elsewhere, or hand-settled? -- and a repair
-- migration must never guess about money. Anything genuinely unbacked is
-- listed in the notices for a human to look at.
DO $$
declare
  b          record;
  v_amount   numeric;
  v_fixed    int := 0;
  v_retired  int := 0;
begin
  -- Step A: reclaim live refunds on restored bookings.
  for b in
    select distinct c.booking_id
      from public.credits c
      join public.bookings bk on bk.id = c.booking_id
     where c.status = 'open'
       and c.source = 'booking_cancellation_return'
       and bk.status <> 'cancelled'
  loop
    v_amount := public.reclaim_returned_credit(b.booking_id);
    if v_amount > 0 then
      v_fixed := v_fixed + 1;
      raise notice 'reclaimed % from restored booking %', v_amount, b.booking_id;
    end if;
  end loop;

  -- Step B: retire stale markers left on live bookings. Amounts untouched.
  for b in
    select distinct c.booking_id
      from public.credits c
      join public.bookings bk on bk.id = c.booking_id
     where c.status = 'settled'
       and c.source = 'booking_cancellation_return'
       and bk.status <> 'cancelled'
  loop
    update public.credits
       set source = 'return_reclaimed'
     where booking_id = b.booking_id
       and source = 'booking_cancellation_return';
    v_retired := v_retired + 1;
    raise notice 'retired a settled refund marker on live booking % (no money changed; check that its account-credit payment is still backed)', b.booking_id;
  end loop;

  raise notice 'stranded refunds reclaimed: %; stale markers retired: %', v_fixed, v_retired;
end $$;
