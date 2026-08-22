-- A diver who cancels in time gets everything they paid back as credit.
--
-- Until now a cancelled booking returned only the ACCOUNT CREDIT it had
-- consumed; cash and transfers were left for an admin to resolve on the
-- holding list. That is right when the diver pulls out late, but not when they
-- cancel within the window the shop advertises: events carry a cancel-by date
-- (events.cancel_date, set on 97% of them) and honoring it by hand on every
-- booking is exactly the kind of step that gets forgotten.
--
-- The rule, in one place so the two approval call sites cannot drift:
--
--   * shop cancels the EVENT      -> every registrant is credited their full
--                                    net paid (issueCancellationCredits, app
--                                    side, unchanged)
--   * diver asked IN TIME         -> credit the full net paid
--   * diver asked LATE, or nobody -> return only the account credit spent, as
--     asked at all                  before; the rest goes to the holding list
--                                    for a human, because a forfeiture should
--                                    never happen automatically
--
-- "Asked" means bookings.refund_requested_at: the diver's own action, not the
-- admin's approval, decides the deadline. An admin who takes two days to
-- approve must not cost the diver their refund. An admin cancelling a booking
-- nobody asked about is not a diver cancellation and credits nothing extra.

-- The shop's timezone, so "on or before the cancel-by date" means the shop's
-- calendar day rather than UTC's. SQL cannot read fundive.config.ts, so this is
-- the one place a fork restates it; shop-timezone.test.ts fails the build if it
-- ever disagrees with locale.timezone.
CREATE OR REPLACE FUNCTION "public"."shop_timezone"() RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$ select 'Asia/Taipei'::text $$;

ALTER FUNCTION "public"."shop_timezone"() OWNER TO "postgres";

-- Was a refund asked for on or before the event's cancel-by date? A null date
-- means the shop set no deadline, so there is none to miss; a null request
-- means nobody asked. Judged on the shop's calendar day, so a diver acting at
-- 23:00 local on the cancel-by date is in time.
CREATE OR REPLACE FUNCTION "public"."cancellation_in_time"(
  "p_requested_at" timestamp with time zone, "p_cancel_date" "date"
) RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select p_requested_at is not null
     and (p_cancel_date is null
          or (p_requested_at at time zone public.shop_timezone())::date <= p_cancel_date)
$$;

ALTER FUNCTION "public"."cancellation_in_time"(timestamp with time zone, "date") OWNER TO "postgres";


-- Replaces bookings_return_account_credit_on_cancel. Renamed because it no
-- longer only returns account credit: it decides how much of what a diver paid
-- comes back, which is a different question with the same trigger point.
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
         coalesce(e.display_title, e.admin_title, e.calendar_title)
    into v_in_time, v_title
    from public.events e
   where e.id = new.event_id;

  -- In time: everything they paid, by whatever method. Late or unasked: only
  -- the account credit, which is internal and the one thing the app can move
  -- on its own. Never more than was actually paid.
  v_amount := least(case when coalesce(v_in_time, false) then v_net_paid else v_account end, v_net_paid);

  if v_amount <= 0 then
    return new;
  end if;

  v_reason := case when coalesce(v_in_time, false)
                   then 'Refund credit for cancellation within the cancel-by date'
                   else 'Account credit returned for cancelled booking'
              end
              || coalesce(': ' || v_title, '');

  insert into public.credits (user_id, booking_id, amount, currency, reason, status, created_by, source)
  values (
    new.user_id, new.id, v_amount, coalesce(v_currency, 'TWD'),
    v_reason, 'open', auth.uid(), 'booking_cancellation_return'
  );

  return new;
end;
$$;

ALTER FUNCTION "public"."bookings_credit_on_cancel"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "trg_bookings_return_account_credit_on_cancel" ON "public"."bookings";
DROP FUNCTION IF EXISTS "public"."bookings_return_account_credit_on_cancel"();

CREATE TRIGGER "trg_bookings_credit_on_cancel"
  AFTER UPDATE OF "status" ON "public"."bookings"
  FOR EACH ROW
  WHEN (OLD."status" IS DISTINCT FROM 'cancelled' AND NEW."status" = 'cancelled')
  EXECUTE FUNCTION "public"."bookings_credit_on_cancel"();
