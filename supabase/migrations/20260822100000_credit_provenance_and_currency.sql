-- Two related fixes to how credits are issued.
--
-- 1. PROVENANCE. Both automatic credit issuers -- issueCancellationCredits
--    (src/lib/credits.ts, when the shop calls off an event) and the
--    bookings_return_account_credit_on_cancel trigger -- guarded against
--    double-issuing with "does this booking carry ANY credit row?". That is
--    far too coarse: a booking carrying an unrelated goodwill credit of 200
--    was skipped entirely, so a diver who had paid 3000 for an event the shop
--    then cancelled received nothing at all. The check has to mean "have we
--    already returned this booking's money?", which needs the rows to say
--    where they came from. Hence credits.source.
--
--    'manual'                      an admin issued it on the Users page
--    'event_cancellation'          issueCancellationCredits, shop called off the event
--    'booking_cancellation_return' the trigger below, returning spent account credit
--    'carry_forward'               the unspent remainder of a partly-consumed credit
--
--    Only the two return sources block a re-issue. Goodwill and carry-forward
--    rows no longer suppress a refund the diver is owed.
--
-- 2. CURRENCY. The credits and payments tables default currency to 'TWD', and
--    the two money RPCs insert payment rows without naming a currency, so
--    every account-credit and group payment row on a non-TWD deployment was
--    stamped TWD while createCredit() wrote the configured currency -- one
--    table, two currencies, silently. The event carries no currency column
--    (AppEvent.currency is siteConfig.locale.currency, resolved client-side),
--    so SQL cannot look it up; instead each insert inherits the currency of
--    the money it is moving, and the dead 'TWD' literal in the trigger goes.
--    The column defaults remain the last-resort fallback and are a
--    per-deployment concern for a fork on another currency.

ALTER TABLE "public"."credits"
  ADD COLUMN IF NOT EXISTS "source" "text" NOT NULL DEFAULT 'manual';

ALTER TABLE "public"."credits"
  DROP CONSTRAINT IF EXISTS "credits_source_check";

ALTER TABLE "public"."credits"
  ADD CONSTRAINT "credits_source_check" CHECK ("source" = ANY (ARRAY[
    'manual'::"text",
    'event_cancellation'::"text",
    'booking_cancellation_return'::"text",
    'carry_forward'::"text"
  ]));

-- Backfill: rows already in the table predate the column and would all read
-- as 'manual', which would let a re-cancel double-issue against history. Both
-- automatic issuers write a fixed, untranslated reason prefix (shop-facing
-- language never reaches these strings), so the existing rows can be
-- classified from it. A carry-forward row copies its parent's reason and so
-- inherits the parent's classification -- which is the conservative answer:
-- its booking has already had its money returned either way.
UPDATE "public"."credits"
   SET "source" = 'event_cancellation'
 WHERE "reason" LIKE 'Refund credit for cancelled event:%';

UPDATE "public"."credits"
   SET "source" = 'booking_cancellation_return'
 WHERE "reason" LIKE 'Account credit returned for cancelled booking%';

CREATE INDEX IF NOT EXISTS "credits_booking_source_idx"
  ON "public"."credits" USING "btree" ("booking_id", "source");


-- apply_credit_to_booking: verbatim copy of the definition in
-- 20260729000000_parent_apply_credit_at_registration.sql except that the
-- carry-forward row is now labeled 'carry_forward' (so it can never suppress
-- a cancellation refund) and the offsetting payment row inherits the currency
-- of the credit it spends instead of falling through to the column default.
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


-- record_group_payment: verbatim copy of the definition in
-- 20260720060000_group_payment_nets_booking_credit.sql except that each
-- inserted payment row inherits the currency already on that booking rather
-- than falling through to the column default.
CREATE OR REPLACE FUNCTION public.record_group_payment(p_lead uuid, p_amount numeric, p_group_id uuid DEFAULT NULL::uuid)
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
      insert into public.payments (user_id, booking_id, amount, status, method, note, recorded_by)
      values (b.user_id, b.id, v_take, 'paid', v_method, 'Group payment', v_caller);
    else
      insert into public.payments (user_id, booking_id, amount, currency, status, method, note, recorded_by)
      values (b.user_id, b.id, v_take, v_currency, 'paid', v_method, 'Group payment', v_caller);
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


-- The return-on-cancel trigger, from
-- 20260723000000_return_account_credit_on_booking_cancel.sql, with the
-- idempotency guard narrowed to the two sources that actually return a
-- booking's money and the dead 'TWD' fallback removed (the query below only
-- runs when matching payment rows exist, so max(currency) cannot be null).
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
         max(currency)
    into v_credit, v_currency
    from public.payments
   where booking_id = new.id
     and method = 'account_credit'
     and status in ('paid', 'refunded');

  -- v_credit > 0 implies matching payment rows exist, and payments.currency is
  -- NOT NULL, so v_currency is non-null from here on.
  if v_credit <= 0 then
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

  select coalesce(e.display_title, e.admin_title, e.calendar_title)
    into v_title
    from public.events e
   where e.id = new.event_id;

  insert into public.credits (user_id, booking_id, amount, currency, reason, status, created_by, source)
  values (
    new.user_id, new.id, v_credit, v_currency,
    'Account credit returned for cancelled booking'
      || coalesce(': ' || v_title, ''),
    'open',
    auth.uid(),
    'booking_cancellation_return'
  );

  return new;
end;
$$;
