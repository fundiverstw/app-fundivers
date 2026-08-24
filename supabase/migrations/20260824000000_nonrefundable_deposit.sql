-- A deposit the shop cannot get back must not be refunded automatically.
--
-- Three of the shop's cancellation policies already say so in the text a diver
-- acknowledges at registration -- "Course with Elearning", "Local Multi-day
-- Trip" and "International Trip" all read "a full refund ... of any payment
-- made above the deposit amount. The deposit, however, is non-refundable."
-- Nothing acted on it. cancellation_policies rows were display text only, so
-- bookings_credit_on_cancel handed back the whole net paid, deposit included,
-- on every in-time cancellation. For a PADI course the deposit is the
-- eLearning: the shop has already bought a code from PADI that cannot be
-- returned, so refunding it means paying the diver out of the shop's pocket.
--
-- The flag rides with the policy, not with the event. An admin picking
-- "Course with Elearning" in the event form gets the retention with it, and
-- the text and the behavior cannot drift apart -- which they would the moment
-- a per-event checkbox existed to forget.

ALTER TABLE "public"."cancellation_policies"
  ADD COLUMN IF NOT EXISTS "deposit_refundable" boolean DEFAULT true NOT NULL;

COMMENT ON COLUMN "public"."cancellation_policies"."deposit_refundable" IS
  'False when the deposit is a sunk cost the shop cannot recover (PADI eLearning, a prepaid room). bookings_credit_on_cancel then withholds it from the cancellation credit.';

-- Backfill from what each policy already promises, so the code starts out
-- matching what divers were told rather than announcing a new rule.
UPDATE "public"."cancellation_policies"
   SET "deposit_refundable" = false
 WHERE "title" IN ('Course with Elearning', 'Local Multi-day Trip', 'International Trip');


-- Replaces the 20260822140000 version. Same three-way rule, one cap added.
--
--   * diver asked IN TIME         -> credit the full net paid
--   * diver asked LATE, or nobody -> return only the account credit spent
--     asked at all
--   * either way, if the event's policy says the deposit is non-refundable,
--     never return more than net paid MINUS that deposit
--
-- The cap applies to both branches on purpose. A non-refundable deposit is
-- gone whatever the diver paid it with -- PADI does not refund the eLearning
-- code because the payment happened to be store credit -- and capping the late
-- branch too keeps the perverse case out: a late canceller who paid by account
-- credit must not walk away with more than one who cancelled in time.
--
-- The withheld deposit is clamped to `owed` as well as to net paid, mirroring
-- depositDue(): a discount can push the frozen deposit above the whole price,
-- and keeping 5,000 of a 3,000 booking is not a deposit, it is a windfall.
--
-- When the withheld deposit is the ONLY thing left on the booking, the trigger
-- also stamps cancellation_settled_at. The holding list at /admin/refunds
-- exists to surface money nobody has dealt with; a deposit kept by a policy
-- the diver acknowledged has been dealt with, and leaving it unstamped would
-- either park an undecidable row there forever or -- worse, since the return
-- credit already suppresses the row -- keep the amount off every screen with
-- nobody ever told. cancellation_settled_by stays null: no person decided
-- this, the policy did, and naming the diver who cancelled would be a lie.
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

  insert into public.credits (user_id, booking_id, amount, currency, reason, status, created_by, source)
  values (
    new.user_id, new.id, v_amount, coalesce(v_currency, 'TWD'),
    v_reason, 'open', auth.uid(), 'booking_cancellation_return'
  );

  return new;
end;
$$;

ALTER FUNCTION "public"."bookings_credit_on_cancel"() OWNER TO "postgres";


-- Restoring a booking has to clear the settle stamp too.
--
-- Until now the stamp only ever arrived by hand, and a restore after one was
-- rare enough to leave alone. The policy retention makes it routine: a booking
-- cancelled in time under a non-refundable-deposit policy is stamped
-- automatically, so a mistaken cancel that is undone would leave a live
-- booking carrying "the shop kept this money". Cancel it again for real and
-- the holding list -- which skips every stamped booking -- would never show
-- the cash. Same reasoning as cancelled_at right beside it: the stamp records
-- an act that no longer happened.
CREATE OR REPLACE FUNCTION "public"."bookings_stamp_cancellation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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
    new.cancelled_at := now();
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
