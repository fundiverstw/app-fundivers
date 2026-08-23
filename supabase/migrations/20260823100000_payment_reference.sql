-- Every payment that moves real money now has to name the thing it came from:
-- a receipt number, a PayPal / online transaction id, a bank transfer
-- reference. Without one, "Paid 3,600" is an assertion nobody can check --
-- the diver has a receipt the shop cannot match, and an admin questioning a
-- figure has only the note field, which is free text nobody fills in.
--
-- Scope of the requirement, and why each exclusion is there:
--
--   * method = 'account_credit' is exempt. Those rows move no money -- the
--     apply-credit RPC writes them so a booking's balance clears, and the cash
--     they stand for arrived earlier on whatever booking generated the credit.
--     There is no external transaction to point at. Same for the 'refunded'
--     account_credit rows the restore-reclaim trigger writes.
--
--   * pending and voided rows are exempt. A pending row is a promise, not a
--     receipt; a voided row is an admin taking back a mistake, and demanding
--     a reference to undo one would leave the mistake standing.
--
--   * NOT VALID, deliberately. Every payment recorded before today has no
--     reference and never will -- validating would fail the migration and
--     back-dating a fake reference is worse than an honest blank. Postgres
--     still enforces the constraint on every INSERT and UPDATE from here on,
--     which is the whole point. Do not VALIDATE this later without first
--     deciding what the historical rows should say.

ALTER TABLE "public"."payments"
  ADD COLUMN IF NOT EXISTS "reference" "text";

COMMENT ON COLUMN "public"."payments"."reference" IS
  'Receipt / bank transfer / online payment transaction id this row is evidence of. Required for money-moving rows (see payments_reference_required); null on account_credit rows, which move no money.';

ALTER TABLE "public"."payments"
  DROP CONSTRAINT IF EXISTS "payments_reference_required";

ALTER TABLE "public"."payments"
  ADD CONSTRAINT "payments_reference_required" CHECK (
    "method" IS NOT DISTINCT FROM 'account_credit'
    OR "status" NOT IN ('paid', 'refunded')
    OR ("reference" IS NOT NULL AND "btrim"("reference") <> '')
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS "payments_reference_idx"
  ON "public"."payments" USING "btree" ("reference")
  WHERE ("reference" IS NOT NULL);

-- record_group_payment writes one real-money payment row per sibling booking,
-- so it needs the reference too. Dropped and recreated rather than given a
-- defaulted fourth argument: a default would let the old three-argument call
-- keep working and quietly write unreferenced rows, which is the exact hole
-- this migration closes. The body is unchanged from 20260822100000 apart from
-- threading p_reference into the two inserts.
DROP FUNCTION IF EXISTS "public"."record_group_payment"("p_lead" "uuid", "p_amount" numeric, "p_group_id" "uuid");

CREATE OR REPLACE FUNCTION "public"."record_group_payment"(
  "p_lead" "uuid", "p_amount" numeric, "p_reference" "text", "p_group_id" "uuid" DEFAULT NULL::"uuid"
)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller    uuid    := auth.uid();
  v_remaining numeric;
  v_applied   numeric := 0;
  v_alloc     jsonb   := '{}'::jsonb;
  v_owed      numeric;
  v_paid      numeric;
  v_due       numeric;
  v_deposit   numeric;
  v_dep_due   numeric;
  v_self_cred numeric;
  v_so_far    numeric;
  v_take      numeric;
  v_method    text;
  v_currency  text;
  b           record;
begin
  if v_caller is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = 'check_violation';
  end if;
  if p_reference is null or btrim(p_reference) = '' then
    raise exception 'a payment reference is required' using errcode = 'check_violation';
  end if;

  v_remaining := p_amount;

  -- Pass 1: cover each sibling's outstanding deposit, oldest first.
  for b in
    select id, details from public.bookings
    where payer_id = p_lead and status <> 'cancelled'
      and (p_group_id is null or group_id = p_group_id)
    order by created_at asc, id asc
  loop
    exit when v_remaining <= 0;
    v_paid := public.booking_net_paid(b.id);
    v_owed := coalesce((b.details ->> 'total')::numeric, 0)
            + coalesce((select sum(amount) from public.booking_amendments
                        where booking_id = b.id), 0);
    -- Credit already tied to this booking offsets its balance on every
    -- surface, so cash must not be collected against it too.
    v_self_cred := coalesce((select sum(amount) from public.credits
                             where booking_id = b.id and status = 'open'), 0);
    v_due := v_owed - v_paid - v_self_cred;
    if v_due <= 0 then continue; end if;
    v_deposit := coalesce((b.details ->> 'deposit')::numeric, 0);
    v_dep_due := least(greatest(v_deposit - v_paid - v_self_cred, 0), v_due);
    if v_dep_due <= 0 then continue; end if;
    v_take := least(v_dep_due, v_remaining);
    v_alloc := jsonb_set(v_alloc, array[b.id::text],
                         to_jsonb(coalesce((v_alloc ->> b.id::text)::numeric, 0) + v_take));
    v_remaining := v_remaining - v_take;
  end loop;

  -- Pass 2: apply the rest against remaining balances, oldest first.
  for b in
    select id, details from public.bookings
    where payer_id = p_lead and status <> 'cancelled'
      and (p_group_id is null or group_id = p_group_id)
    order by created_at asc, id asc
  loop
    exit when v_remaining <= 0;
    v_paid := public.booking_net_paid(b.id);
    v_owed := coalesce((b.details ->> 'total')::numeric, 0)
            + coalesce((select sum(amount) from public.booking_amendments
                        where booking_id = b.id), 0);
    v_so_far := coalesce((v_alloc ->> b.id::text)::numeric, 0);
    v_self_cred := coalesce((select sum(amount) from public.credits
                             where booking_id = b.id and status = 'open'), 0);
    v_due := v_owed - v_paid - v_self_cred - v_so_far;
    if v_due <= 0 then continue; end if;
    v_take := least(v_due, v_remaining);
    v_alloc := jsonb_set(v_alloc, array[b.id::text],
                         to_jsonb(v_so_far + v_take));
    v_remaining := v_remaining - v_take;
  end loop;

  -- Settle: one payment row per allocated booking; confirm pending spots
  -- whose deposit is now covered.
  for b in
    select id, user_id, status, details from public.bookings
    where payer_id = p_lead and status <> 'cancelled'
      and (p_group_id is null or group_id = p_group_id)
    order by created_at asc, id asc
  loop
    v_take := coalesce((v_alloc ->> b.id::text)::numeric, 0);
    if v_take <= 0 then continue; end if;
    v_method := b.details ->> 'payment_method';
    -- Inherit whatever currency this booking's money is already denominated
    -- in; null falls through to the column default.
    select currency into v_currency from (
      select currency, created_at from public.payments where booking_id = b.id
      union all
      select currency, created_at from public.credits  where booking_id = b.id
    ) prior order by created_at asc limit 1;

    -- Two branches because a first payment has nothing to inherit from, and
    -- naming the column with a null would violate payments.currency NOT NULL;
    -- omitting it takes the column default instead.
    if v_currency is null then
      insert into public.payments (user_id, booking_id, amount, status, method, note, reference, recorded_by)
      values (b.user_id, b.id, v_take, 'paid', v_method, 'Group payment', btrim(p_reference), v_caller);
    else
      insert into public.payments (user_id, booking_id, amount, currency, status, method, note, reference, recorded_by)
      values (b.user_id, b.id, v_take, v_currency, 'paid', v_method, 'Group payment', btrim(p_reference), v_caller);
    end if;

    v_applied := v_applied + v_take;

    v_paid := public.booking_net_paid(b.id);
    v_deposit := coalesce((b.details ->> 'deposit')::numeric, 0);
    -- Clamped to what is owed, for the same reason as the allocation pass
    -- above: a discount can push the frozen deposit past the balance.
    v_owed := coalesce((b.details ->> 'total')::numeric, 0)
            + coalesce((select sum(amount) from public.booking_amendments
                        where booking_id = b.id), 0);
    if b.status = 'pending' and v_paid >= least(v_deposit, v_owed) then
      update public.bookings set status = 'confirmed' where id = b.id;
    end if;
  end loop;

  return v_applied;
end;
$function$;

ALTER FUNCTION "public"."record_group_payment"("p_lead" "uuid", "p_amount" numeric, "p_reference" "text", "p_group_id" "uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."record_group_payment"("p_lead" "uuid", "p_amount" numeric, "p_reference" "text", "p_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_group_payment"("p_lead" "uuid", "p_amount" numeric, "p_reference" "text", "p_group_id" "uuid") TO "authenticated";
