-- Cancelling an event cancels the registrations on it.
--
-- A shop-side cancellation set events.cancelled_at and stopped. The bookings
-- stayed 'confirmed', so every surface that asks "does this booking still owe
-- anything" -- and every one of them asks booking.status -- kept the frozen
-- details.total alive as a live debt on an event that will not happen. The
-- cancellation credit is tied to the booking it came off, so bookingBalance
-- netted the refund straight back into that phantom debt:
--
--   Marius Drop, two cancelled courses, 2,500 paid on each.
--   Nitrox  owed 5,440 - paid 2,500 - credit 2,500 = 440 "due"
--   Deep    owed 7,240 - paid 2,500 - credit 2,500 = 2,240 "due"
--   spendable account credit: 0. Statement balance: -2,680, i.e. the app said
--   he owed the shop money. True position: 5,000 in his favor, owing nothing.
--
-- The money rows were right all along; every reader of them was wrong. Rather
-- than teach seven balance call sites a second question, this makes the answer
-- to the question they already ask correct: the event cancels its bookings,
-- and 'cancelled' means cancelled whoever called it.
--
-- That also retires the duplicate. "Cancel a registration and give the money
-- back" existed twice -- bookings_credit_on_cancel here, issueCancellationCredits
-- in TypeScript -- with the same net-paid sum, the same payer split, the same
-- account-credit split and the same idempotency guard written out in two
-- languages. The bug was the two copies disagreeing about what counts as
-- cancelled. One copy survives, this one.


-- Which status to put a booking back to when the event is restored.
--
-- Non-null means "its event cancelled this, it did not cancel itself", which
-- restore needs both to pick the rows and to recover 'waitlisted' -- a status
-- nothing else could reconstruct. A diver who had already pulled out before
-- the event was called off has it null and stays cancelled.
ALTER TABLE "public"."bookings"
  ADD COLUMN IF NOT EXISTS "status_before_event_cancel" "text";

COMMENT ON COLUMN "public"."bookings"."status_before_event_cancel" IS
  'Status to restore when the event is un-cancelled. Non-null marks a booking cancelled BY its event rather than by a person.';


-- A diver may cancel their own booking; they may not claim the event did it.
-- Forging this would survive an event restore and put the booking back to any
-- status they liked, capacity checks included.
CREATE OR REPLACE FUNCTION "public"."bookings_guard_diver_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  -- SECURITY DEFINER RPCs run as their owner (accept_waitlist_offer promotes
  -- waitlisted -> pending; apply_credit_to_booking promotes pending ->
  -- confirmed at the deposit threshold), and migrations / edge functions /
  -- push workers run as postgres or service_role. Only a direct PostgREST call
  -- from a diver runs as 'authenticated'. This function is SECURITY INVOKER on
  -- purpose so current_user reflects that real context.
  if current_user <> 'authenticated' then
    return new;
  end if;

  -- Staff acting through the app hold an authenticated session too, so gate
  -- them by role, not by current_user.
  if public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('pending', 'waitlisted') then
      raise exception 'a booking can only be created as pending or waitlisted'
        using errcode = 'check_violation';
    end if;
    if new.status_before_event_cancel is not null then
      raise exception 'only an event cancellation sets status_before_event_cancel'
        using errcode = 'insufficient_privilege';
    end if;
    if new.cancellation_settled_at is not null
       or new.cancellation_settled_by is not null
       or new.cancellation_settled_note is not null then
      raise exception 'settling a cancellation is staff-only'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status and new.status <> 'cancelled' then
    raise exception 'divers may only cancel a booking; other status changes are staff-only'
      using errcode = 'check_violation';
  end if;

  if new.status_before_event_cancel is distinct from old.status_before_event_cancel then
    raise exception 'only an event cancellation sets status_before_event_cancel'
      using errcode = 'insufficient_privilege';
  end if;

  -- Capacity is only re-checked on INSERT, so a diver must not re-home a
  -- booking onto a different (possibly full) event.
  if new.event_id is distinct from old.event_id then
    raise exception 'a booking cannot be moved to a different event'
      using errcode = 'check_violation';
  end if;

  -- Acknowledging that the shop keeps a cancelled booking's money is an admin
  -- decision. A diver marking their own booking settled would erase it from
  -- the holding list while the shop still held their cash.
  if new.cancellation_settled_at   is distinct from old.cancellation_settled_at
     or new.cancellation_settled_by   is distinct from old.cancellation_settled_by
     or new.cancellation_settled_note is distinct from old.cancellation_settled_note then
    raise exception 'settling a cancellation is staff-only'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

DROP TRIGGER IF EXISTS "trg_bookings_guard_diver_status" ON "public"."bookings";
CREATE TRIGGER "trg_bookings_guard_diver_status"
  BEFORE INSERT OR UPDATE OF "status", "status_before_event_cancel", "event_id",
    "cancellation_settled_at", "cancellation_settled_by", "cancellation_settled_note"
  ON "public"."bookings"
  FOR EACH ROW EXECUTE FUNCTION "public"."bookings_guard_diver_status"();


-- A booking cancelled by its event is stamped with the EVENT's cancellation
-- time, not the moment this row happened to be rewritten. Still derived, never
-- taken from the caller.
CREATE OR REPLACE FUNCTION "public"."bookings_stamp_cancellation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_event_cancelled timestamptz;
begin
  if tg_op = 'INSERT' then
    -- Derived, never accepted from the caller: a diver cannot post a booking
    -- that claims someone else cancelled it.
    if new.status = 'cancelled' then
      new.cancelled_at := now();
      new.cancelled_by := auth.uid();
    else
      new.cancelled_at := null;
      new.cancelled_by := null;
    end if;
    return new;
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    if new.status_before_event_cancel is not null and new.event_id is not null then
      select e.cancelled_at into v_event_cancelled
        from public.events e where e.id = new.event_id;
    end if;
    new.cancelled_at := coalesce(v_event_cancelled, now());
    new.cancelled_by := auth.uid();
  elsif new.status <> 'cancelled' then
    -- Restored. It is not a cancelled booking any more, and the reclaim
    -- trigger has already put its money back where it belongs.
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.cancellation_settled_at   := null;
    new.cancellation_settled_by   := null;
    new.cancellation_settled_note := null;
  else
    -- Still cancelled: the stamp records a past act and does not move.
    new.cancelled_at := old.cancelled_at;
    new.cancelled_by := old.cancelled_by;
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."bookings_stamp_cancellation"() OWNER TO "postgres";


-- The shop calling an event off is not a cancellation the diver has to answer
-- for, so no policy that withholds money on a LATE cancellation applies to it:
-- they get back everything they paid, cancel-by date and non-refundable
-- deposit alike. That exemption is the only thing issueCancellationCredits
-- knew that this function did not, and it is why the two existed separately.
--
-- Provenance is preserved: a shop cancellation still writes
-- 'event_cancellation', a person cancelling one booking still writes
-- 'booking_cancellation_return'. Both are return sources everywhere that asks.
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
  v_evt_off   timestamptz;
  v_source    text;
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
         coalesce(p.deposit_refundable, true),
         e.cancelled_at
    into v_in_time, v_title, v_dep_ok, v_evt_off
    from public.events e
    left join public.cancellation_policies p on p.id = e.cancel_policy
   where e.id = new.event_id;

  -- The shop called it off: everything back, no timeliness test, no deposit
  -- withheld. Nothing the diver did is in question.
  if v_evt_off is not null then
    v_in_time := true;
    v_dep_ok  := true;
  end if;

  v_source := case when v_evt_off is not null
                   then 'event_cancellation'
                   else 'booking_cancellation_return' end;

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

  v_reason := case
                when v_evt_off is not null
                  then 'Refund credit for cancelled event'
                when coalesce(v_in_time, false)
                  then 'Refund credit for cancellation within the cancel-by date'
                else 'Account credit returned for cancelled booking'
              end
              || coalesce(': ' || v_title, '')
              || case when v_keep > 0 then ' (non-refundable deposit withheld)' else '' end;

  v_payer := coalesce(new.payer_id, new.user_id);

  if v_payer = new.user_id then
    insert into public.credits (user_id, booking_id, amount, currency, reason, status, created_by, source)
    values (new.user_id, new.id, v_amount, coalesce(v_currency, 'TWD'),
            v_reason, 'open', auth.uid(), v_source);
    return new;
  end if;

  v_own := least(v_amount, greatest(v_account, 0));

  if v_own > 0 then
    insert into public.credits (user_id, booking_id, amount, currency, reason, status, created_by, source)
    values (new.user_id, new.id, v_own, coalesce(v_currency, 'TWD'),
            v_reason || ' (store credit returned to the diver who spent it)',
            'open', auth.uid(), v_source);
  end if;

  if v_amount - v_own > 0 then
    insert into public.credits (user_id, booking_id, amount, currency, reason, status, created_by, source)
    values (v_payer, new.id, v_amount - v_own, coalesce(v_currency, 'TWD'),
            v_reason || ' (returned to the lead booker who paid)',
            'open', auth.uid(), v_source);
  end if;

  return new;
end;
$$;

ALTER FUNCTION "public"."bookings_credit_on_cancel"() OWNER TO "postgres";


-- Reclaim on restore has to recognize BOTH return sources.
--
-- It matched only 'booking_cancellation_return' in all four places it looked,
-- while the issue guard above matched both. The asymmetry was invisible while
-- an 'event_cancellation' credit could never sit on a cancelled booking; now
-- that cancelling an event cancels its bookings, a narrow match here would
-- silently reclaim nothing -- leaving a restored event's divers holding the
-- refund AND owing the balance again.
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
     and source in ('event_cancellation', 'booking_cancellation_return');

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
       and source in ('event_cancellation', 'booking_cancellation_return', 'carry_forward')
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
  -- as a return source they would still read as "this booking's money is given
  -- back", which would both suppress the next cancellation's refund and make
  -- the next restore reclaim the same money again.
  update public.credits
     set source = 'return_reclaimed'
   where booking_id = new.id
     and source in ('event_cancellation', 'booking_cancellation_return');

  return new;
end;
$$;

ALTER FUNCTION "public"."bookings_reclaim_returned_credit_on_restore"() OWNER TO "postgres";


-- The event drives its bookings.
--
-- Cancelling remembers each booking's status and cancels it, which hands the
-- money to bookings_credit_on_cancel; restoring puts each back and hands it to
-- bookings_reclaim_returned_credit_on_restore. Divers who had already
-- cancelled are untouched in both directions.
--
-- Safe against the other cancel-time triggers by construction: this is an
-- AFTER trigger, so events.cancelled_at is already set when they run, and
-- offer_next_waitlist_spot returns null on a cancelled event -- no waitlisted
-- diver is promoted into a spot on an event that is not happening.
CREATE OR REPLACE FUNCTION "public"."events_cancel_bookings"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.cancelled_at is not null then
    update public.bookings
       set status_before_event_cancel = status,
           status = 'cancelled'
     where event_id = new.id
       and status <> 'cancelled';
  else
    update public.bookings
       set status = status_before_event_cancel,
           status_before_event_cancel = null
     where event_id = new.id
       and status_before_event_cancel is not null;
  end if;
  return null;
end;
$$;

ALTER FUNCTION "public"."events_cancel_bookings"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "trg_events_cancel_bookings" ON "public"."events";
CREATE TRIGGER "trg_events_cancel_bookings"
  AFTER UPDATE OF "cancelled_at" ON "public"."events"
  FOR EACH ROW WHEN (OLD."cancelled_at" IS DISTINCT FROM NEW."cancelled_at")
  EXECUTE FUNCTION "public"."events_cancel_bookings"();


-- Credit cannot be spent into an event that is not happening.
--
-- The existing guard refuses a cancelled BOOKING, which now covers every
-- registration on a cancelled event. It does not cover a booking created after
-- the event was called off: nothing blocks registering on a cancelled event
-- (only the browse queries filter them), so such a booking is 'pending' on a
-- dead event and the status test misses it. Six lines close that for good.
CREATE OR REPLACE FUNCTION "public"."apply_credit_to_booking"("p_booking_id" "uuid", "p_amount" numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_caller    uuid    := auth.uid();
  v_is_admin  boolean := public.is_admin();
  v_booking   public.bookings%rowtype;
  v_owed      numeric;
  v_paid      numeric;
  v_self_cred numeric;
  v_due       numeric;
  v_avail     numeric;
  v_apply     numeric;
  v_deposit   numeric;
  v_remaining numeric;
  v_take      numeric;
  v_currency  text;
  c           record;
begin
  if v_caller is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'booking not found' using errcode = 'no_data_found';
  end if;

  -- A diver may spend against their own booking; a parent against their
  -- child's; admins against anyone's.
  if v_booking.user_id <> v_caller
     and not v_is_admin
     and not exists (
       select 1 from public.profiles
       where id = v_booking.user_id and parent_account = v_caller
     )
  then
    raise exception 'not your booking' using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = 'check_violation';
  end if;

  -- A cancelled booking has no live balance to settle -- its frozen
  -- details.total is not money owed. Refuse rather than burn credit into it.
  if v_booking.status = 'cancelled' then
    raise exception 'cannot apply credit to a cancelled booking'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.events e
              where e.id = v_booking.event_id and e.cancelled_at is not null) then
    raise exception 'cannot apply credit to a booking on a cancelled event'
      using errcode = 'check_violation';
  end if;

  -- owed = frozen total snapshot + signed amendment ledger.
  v_owed := coalesce((v_booking.details ->> 'total')::numeric, 0)
          + coalesce((select sum(amount) from public.booking_amendments
                      where booking_id = p_booking_id), 0);

  v_paid := public.booking_net_paid(p_booking_id);

  -- Credit already tied to THIS booking is shown as an offset against its
  -- balance everywhere in the UI, so the spendable "balance due" nets it out
  -- and we never re-spend it. The pool we consume is the diver's OTHER open
  -- credit (general credits + credits from other/cancelled bookings).
  v_self_cred := coalesce((select sum(amount) from public.credits
                           where booking_id = p_booking_id
                             and user_id = v_booking.user_id
                             and status = 'open'), 0);

  v_due := v_owed - v_paid - v_self_cred;
  if v_due <= 0 then
    return 0;
  end if;

  -- Nets account charges (negative rows, source 'admin_charge'), so a diver
  -- who owes the shop for goods cannot spend credit they have effectively
  -- already used. The <= 0 guard below covers the case where charges swallow
  -- the whole pool.
  v_avail := coalesce((select sum(amount) from public.credits
                       where user_id = v_booking.user_id
                         and status = 'open'
                         and booking_id is distinct from p_booking_id), 0);
  if v_avail <= 0 then
    return 0;
  end if;

  v_apply := least(p_amount, v_due, v_avail);

  -- The payment row records money moving out of these credit rows, so it is
  -- denominated in their currency, not the table's TWD default.
  select currency into v_currency
    from public.credits
   where user_id = v_booking.user_id
     and status = 'open'
     and amount > 0
     and booking_id is distinct from p_booking_id
   order by created_at asc, id asc
   limit 1;

  -- Consume open credit rows oldest-first. A row fully covered by the
  -- remaining need is settled; the row that straddles the boundary is
  -- settled in full and its unspent part carried forward as a new open row.
  v_remaining := v_apply;
  for c in
    select id, amount, reason, booking_id, currency, created_by
    from public.credits
    where user_id = v_booking.user_id
      and status = 'open'
      -- Charges are money the diver OWES; they net out of v_avail above but
      -- must never be consumed here. Settling one would erase the debt and
      -- `least(c.amount, v_remaining)` on a negative would hand credit back.
      and amount > 0
      and booking_id is distinct from p_booking_id
    order by created_at asc, id asc
  loop
    exit when v_remaining <= 0;
    v_take := least(c.amount, v_remaining);

    update public.credits
    set status       = 'settled',
        settled_at   = now(),
        settled_note = 'Applied ' || c.currency || ' ' || v_take
                       || ' to booking ' || p_booking_id
                       || case when c.amount > v_take
                               then '; ' || c.currency || ' ' || (c.amount - v_take)
                                    || ' carried forward'
                               else '' end
    where id = c.id;

    if c.amount > v_take then
      insert into public.credits (user_id, booking_id, amount, currency, reason, status, created_by, source)
      values (v_booking.user_id, c.booking_id, c.amount - v_take, c.currency, c.reason, 'open', c.created_by, 'carry_forward');
    end if;

    v_remaining := v_remaining - v_take;
  end loop;

  -- v_currency cannot be null here: v_avail > 0 guarantees at least one open
  -- credit row, and credits.currency is NOT NULL.
  insert into public.payments (user_id, booking_id, amount, currency, status, method, note, recorded_by)
  values (
    v_booking.user_id, p_booking_id, v_apply, v_currency,
    'paid', 'account_credit', 'Applied account credit', v_caller
  );

  -- Crossing the deposit threshold confirms a pending spot, matching
  -- recordPayment()'s promotion rule.
  v_deposit := coalesce((v_booking.details ->> 'deposit')::numeric, 0);
  -- Against the deposit clamped to what is owed. The deposit is frozen at
  -- booking time and amendments never reduce it, so after a discount it can
  -- exceed the balance -- and a diver settling that balance in full would never
  -- cross it, leaving their booking pending forever.
  if v_booking.status = 'pending' and (v_paid + v_apply) >= least(v_deposit, v_owed) then
    update public.bookings set status = 'confirmed' where id = p_booking_id;
  end if;

  return v_apply;
end;
$$;

ALTER FUNCTION "public"."apply_credit_to_booking"("p_booking_id" "uuid", "p_amount" numeric) OWNER TO "postgres";


-- Repair the events already cancelled under the old behavior.
--
-- The credit trigger is suppressed for the sweep and the money is settled
-- afterwards on a STRICTER test than the trigger's. The trigger asks only
-- whether a return-source credit exists, deliberately, so that a small
-- goodwill award cannot swallow a whole refund. Applied to history that rule
-- pays twice: at least one of these refunds was recorded by hand as a
-- 'manual' credit for the full amount, and the trigger cannot see it.
--
-- So the repair counts EVERY positive credit already tied to the booking. A
-- booking whose refund was recorded by any route is left alone; only money
-- genuinely still held gets a new credit. Anything the arithmetic cannot
-- settle stays visible on the refund holding list, where a person decides.
ALTER TABLE "public"."bookings" DISABLE TRIGGER "trg_bookings_credit_on_cancel";

UPDATE "public"."bookings" b
   SET "status_before_event_cancel" = b."status",
       "status" = 'cancelled'
  FROM "public"."events" e
 WHERE e."id" = b."event_id"
   AND e."cancelled_at" IS NOT NULL
   AND b."status" <> 'cancelled';

ALTER TABLE "public"."bookings" ENABLE TRIGGER "trg_bookings_credit_on_cancel";

INSERT INTO "public"."credits"
  ("user_id", "booking_id", "amount", "currency", "reason", "status", "created_by", "source")
SELECT b."user_id",
       b."id",
       public.booking_net_paid(b."id") - coalesce(tied."total", 0),
       coalesce((select max(p."currency") from public."payments" p
                  where p."booking_id" = b."id"), 'TWD'),
       'Refund credit for cancelled event: '
         || coalesce(e."display_title", e."admin_title", e."calendar_title"),
       'open',
       NULL,
       'event_cancellation'
  FROM "public"."bookings" b
  JOIN "public"."events" e ON e."id" = b."event_id"
  LEFT JOIN LATERAL (
    SELECT sum(c."amount") AS "total"
      FROM "public"."credits" c
     WHERE c."booking_id" = b."id" AND c."amount" > 0
  ) tied ON true
 WHERE b."status_before_event_cancel" IS NOT NULL
   AND b."user_id" IS NOT NULL
   AND public.booking_net_paid(b."id") - coalesce(tied."total", 0) > 0;
