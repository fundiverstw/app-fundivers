-- An account charge: money the diver owes the shop for something that is not
-- a booking. A mask off the rack, a lost fin, a tank fill.
--
-- The shop had no way to record one. Everything that moved a diver's balance
-- had to hang off an event -- `booking_amendments` needs a booking_id -- so an
-- admin whose diver walked out with a 1,200 mask against their store credit
-- either left the credit standing (wrong) or settled the whole thing with a
-- free-text note (worse: the amount vanished with no arithmetic behind it).
--
-- A charge is the mirror of a credit and lives in the same table as a NEGATIVE
-- amount, rather than in a table of its own. Every balance in the app is
-- already `sum(amount) where status = 'open'` -- `openCreditBalance`,
-- `diverCreditBalance`, the apply-credit RPC's available pool -- so a signed
-- row nets itself into all of them at once. A separate table would have meant
-- teaching each of those about a second source, and the one that got missed
-- would be a diver spending money they owed.
--
-- Two constraints keep the sign honest, because "credit" now means the
-- positive half of a signed ledger and nothing else may cross over:
--
--   * only source 'admin_charge' may be negative, and it MUST be
--   * a charge is never tied to a booking -- a booking-tied charge is what
--     `booking_amendments` is for, and letting one in here would corrupt
--     `openCreditForBooking` and the RPC's self-credit netting

ALTER TABLE "public"."credits" DROP CONSTRAINT IF EXISTS "credits_source_check";

ALTER TABLE "public"."credits"
  ADD CONSTRAINT "credits_source_check" CHECK ("source" = ANY (ARRAY[
    'manual'::"text",
    'event_cancellation'::"text",
    'booking_cancellation_return'::"text",
    'carry_forward'::"text",
    'return_reclaimed'::"text",
    'admin_charge'::"text"
  ]));

ALTER TABLE "public"."credits" DROP CONSTRAINT IF EXISTS "credits_amount_check";

ALTER TABLE "public"."credits"
  ADD CONSTRAINT "credits_amount_check" CHECK (
    CASE WHEN "source" = 'admin_charge' THEN "amount" < 0 ELSE "amount" > 0 END
  );

ALTER TABLE "public"."credits" DROP CONSTRAINT IF EXISTS "credits_charge_untied";

ALTER TABLE "public"."credits"
  ADD CONSTRAINT "credits_charge_untied" CHECK (
    "source" <> 'admin_charge' OR "booking_id" IS NULL
  );

COMMENT ON COLUMN "public"."credits"."amount" IS
  'Signed. Positive = money the shop owes the diver (a credit). Negative = money the diver owes the shop (source admin_charge only).';

-- apply_credit_to_booking, verbatim from 20260822100000 apart from the three
-- places that now have to tell a credit from a charge. Re-emitted in full
-- because that is the only way Postgres accepts a function change.
CREATE OR REPLACE FUNCTION public.apply_credit_to_booking(p_booking_id uuid, p_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
ALTER FUNCTION "public"."apply_credit_to_booking"("p_booking_id" "uuid", "p_amount" numeric) OWNER TO "postgres";
