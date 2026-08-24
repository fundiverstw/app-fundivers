-- Return a cancelled booking's money to whoever paid it.
--
-- A lead booker's bookings carry payer_id, and the app is explicit about what
-- that means: the money on those bookings "belongs to the lead, not this
-- diver". diverCreditBalance drops them from the diver's spendable pool and
-- counts them toward the lead, and record_group_payment writes the payment row
-- under the DIVER's user_id precisely because the display layer re-routes it.
--
-- The cancellation credit never got that treatment. It was written to
-- new.user_id, and the moment the booking is cancelled the re-routing stops
-- applying -- a cancelled booking is not in anyone's active set, so the credit
-- falls through as the diver's own general credit. A lead who paid 15,400 for
-- a friend's course watched the friend cancel, receive 15,400 of spendable
-- store credit, and the lead was out the money with no row anywhere naming
-- them. RLS meant they could not even see the credit.
--
-- Account credit is the exception, and it splits the refund in two. Money
-- spent from the store-credit pool came from the BOOKING OWNER's pool --
-- apply_credit_to_booking only ever consumes v_booking.user_id's rows, whoever
-- triggered it -- so returning it to the lead would take the diver's credit and
-- hand it to somebody else. Each half goes back where it came from:
--
--   the account-credit part  -> the booking owner, whose pool it left
--   everything else          -> the payer, whose money it was
--
-- With no payer_id (or payer_id = user_id) the two halves are the same person
-- and it stays one row, exactly as before.
CREATE OR REPLACE FUNCTION "public"."bookings_credit_on_cancel"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_net_paid  numeric;
  v_account   numeric;
  v_amount    numeric;
  v_currency  text;
  v_title     text;
  v_in_time   boolean;
  v_reason    text;
  v_dep_ok    boolean;
  v_owed      numeric;
  v_keep      numeric := 0;
  v_payer     uuid;
  v_own       numeric;
begin
  if new.user_id is null then
    return new;
  end if;

  -- Only a credit that already RETURNED this booking's money blocks a second
  -- return. A goodwill credit or a carry-forward row tied to the booking is
  -- unrelated money and must not suppress the refund.
  if exists (
    select 1 from public.credits
     where booking_id = new.id
       and source in ('event_cancellation', 'booking_cancellation_return')
  ) then
    return new;
  end if;

  select coalesce(sum(case when status = 'refunded' then -amount else amount end), 0),
         max(currency)
    into v_net_paid, v_currency
    from public.payments
   where booking_id = new.id
     and status in ('paid', 'refunded');

  select coalesce(sum(case when status = 'refunded' then -amount else amount end), 0)
    into v_account
    from public.payments
   where booking_id = new.id
     and method = 'account_credit'
     and status in ('paid', 'refunded');

  select public.cancellation_in_time(new.refund_requested_at, e.cancel_date),
         coalesce(e.display_title, e.admin_title, e.calendar_title),
         coalesce(p.deposit_refundable, true)
    into v_in_time, v_title, v_dep_ok
    from public.events e
    left join public.cancellation_policies p on p.id = e.cancel_policy
   where e.id = new.event_id;

  if not coalesce(v_dep_ok, true) then
    v_owed := coalesce((new.details ->> 'total')::numeric, 0)
            + coalesce((select sum(amount) from public.booking_amendments
                        where booking_id = new.id), 0);
    v_keep := greatest(least(
      coalesce((new.details ->> 'deposit')::numeric, 0), v_owed, v_net_paid), 0);
  end if;

  -- In time: everything they paid, by whatever method. Late or unasked: only
  -- the account credit, which is internal and the one thing the app can move
  -- on its own. Never more than was actually paid, and never the deposit the
  -- shop has already spent.
  v_amount := least(
    case when coalesce(v_in_time, false) then v_net_paid else v_account end,
    v_net_paid - v_keep);

  -- The deposit is the whole of what stays behind, so no human has a decision
  -- left to make on this booking.
  if v_keep > 0 and v_net_paid - greatest(v_amount, 0) = v_keep then
    update public.bookings
       set cancellation_settled_at   = now(),
           cancellation_settled_note = 'Non-refundable deposit kept under the event''s cancellation policy: '
                                       || to_char(v_keep, 'FM999999990.00') || ' ' || coalesce(v_currency, 'TWD')
     where id = new.id;
  end if;

  if v_amount <= 0 then
    return new;
  end if;

  v_reason := case when coalesce(v_in_time, false)
                   then 'Refund credit for cancellation within the cancel-by date'
                   else 'Account credit returned for cancelled booking'
              end
              || coalesce(': ' || v_title, '')
              || case when v_keep > 0 then ' (non-refundable deposit withheld)' else '' end;

  v_payer := coalesce(new.payer_id, new.user_id);

  if v_payer = new.user_id then
    insert into public.credits (user_id, booking_id, amount, currency, reason, status, created_by, source)
    values (new.user_id, new.id, v_amount, coalesce(v_currency, 'TWD'),
            v_reason, 'open', auth.uid(), 'booking_cancellation_return');
    return new;
  end if;

  v_own := least(v_amount, greatest(v_account, 0));

  if v_own > 0 then
    insert into public.credits (user_id, booking_id, amount, currency, reason, status, created_by, source)
    values (new.user_id, new.id, v_own, coalesce(v_currency, 'TWD'),
            v_reason || ' (store credit returned to the diver who spent it)',
            'open', auth.uid(), 'booking_cancellation_return');
  end if;

  if v_amount - v_own > 0 then
    insert into public.credits (user_id, booking_id, amount, currency, reason, status, created_by, source)
    values (v_payer, new.id, v_amount - v_own, coalesce(v_currency, 'TWD'),
            v_reason || ' (returned to the lead booker who paid)',
            'open', auth.uid(), 'booking_cancellation_return');
  end if;

  return new;
end;
$$;

ALTER FUNCTION "public"."bookings_credit_on_cancel"() OWNER TO "postgres";


-- The reclaim-on-restore trigger has to follow the money the same way.
--
-- It finds and settles rows by booking_id, which stays right whoever owns
-- them, but the partial-reclaim branch minted the unspent tail under
-- new.user_id. On a lead-covered booking that quietly moved the remainder of
-- the LEAD's credit into the diver's pool -- the same misrouting, one step
-- later. The tail belongs to whoever held the row it came off.
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
    select id, user_id, amount, currency, reason, created_by, booking_id
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
      values (c.user_id, c.booking_id, c.amount - v_take, c.currency, c.reason, 'open', c.created_by, 'carry_forward');
    end if;

    v_reclaim := v_reclaim - v_take;
  end loop;

  -- Anything we could not reclaim was already spent on another booking. That
  -- money is gone from this one, so its account-credit payment no longer backs
  -- it in full. The payment row stays under the booking owner, matching
  -- record_group_payment: payments are attributed by booking, not by payer.
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
