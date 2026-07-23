-- Cancelling a booking must hand back the account credit it consumed.
--
-- apply_credit_to_booking settles the diver's open credit rows and records an
-- offsetting 'account_credit' payment against the booking. Cancelling the
-- booking then left that money stranded: bookingBalance short-circuits a
-- cancelled booking to "settled", so the payment stops offsetting anything,
-- and the credit rows it consumed are already settled. The diver was simply
-- out the money.
--
-- Off-app methods (bank transfer, cash, card) are deliberately NOT handled
-- here — approving a refund cancels the booking and the money moves off-app,
-- which is the existing documented flow (AdminRefundsPage.approve). Account
-- credit is the one method whose "refund" is purely internal, so it is the one
-- the app can and must reverse on its own.
--
-- Shape of the reversal mirrors issueCancellationCredits (src/lib/credits.ts):
-- a fresh OPEN credit row tied to the booking, leaving the original payments
-- untouched. diverCreditBalance counts a credit tied to a cancelled booking as
-- a general credit, so it lands back in the diver's spendable balance, and the
-- audit trail still shows both the spend and the return.
--
-- Idempotent on "the booking already carries a credit", the same rule
-- issueCancellationCredits uses. That also stops a double refund when an admin
-- cancels a whole event (which credits every registrant their full net paid)
-- and then cancels the individual bookings.

CREATE OR REPLACE FUNCTION "public"."bookings_return_account_credit_on_cancel"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_credit   numeric;
  v_currency text;
  v_title    text;
begin
  if new.user_id is null then
    return new;
  end if;

  -- Net account credit spent on this booking: applied minus anything already
  -- reversed, so a manual reversal is never double-counted.
  select coalesce(sum(case when status = 'refunded' then -amount else amount end), 0),
         coalesce(max(currency), 'TWD')
    into v_credit, v_currency
    from public.payments
   where booking_id = new.id
     and method = 'account_credit'
     and status in ('paid', 'refunded');

  if v_credit <= 0 then
    return new;
  end if;

  if exists (select 1 from public.credits where booking_id = new.id) then
    return new;
  end if;

  select coalesce(e.display_title, e.admin_title, e.calendar_title)
    into v_title
    from public.events e
   where e.id = new.event_id;

  insert into public.credits (user_id, booking_id, amount, currency, reason, status, created_by)
  values (
    new.user_id, new.id, v_credit, v_currency,
    'Account credit returned for cancelled booking'
      || coalesce(': ' || v_title, ''),
    'open',
    auth.uid()
  );

  return new;
end;
$$;

ALTER FUNCTION "public"."bookings_return_account_credit_on_cancel"() OWNER TO "postgres";

CREATE TRIGGER "trg_bookings_return_account_credit_on_cancel"
  AFTER UPDATE OF "status" ON "public"."bookings"
  FOR EACH ROW
  WHEN (OLD."status" IS DISTINCT FROM 'cancelled' AND NEW."status" = 'cancelled')
  EXECUTE FUNCTION "public"."bookings_return_account_credit_on_cancel"();
