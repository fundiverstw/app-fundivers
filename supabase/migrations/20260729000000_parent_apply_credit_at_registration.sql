-- Let a parent spend their child's account credit.
--
-- apply_credit_to_booking spends the BOOKING OWNER's open credit (v_booking.
-- user_id), never the caller's — so "apply the diver's credit" is already the
-- correct money movement. But the auth gate only allowed the owner themselves
-- or an admin, so a parent registering/paying for their child (a core
-- parent-child flow) was rejected with "not your booking", even though a parent
-- can already SELECT the child's credit rows (migration 20260720010000).
--
-- Widen the gate: a parent (profiles.parent_account = the caller) may spend
-- against their child's booking, matching the existing "parent select children"
-- read policies. Self and admin are unchanged. This mirrors how the registration
-- form now offers "apply {child}'s credit" when a parent books on their behalf.
--
-- The body is otherwise a verbatim copy of the definition in
-- 20260720050000_clamp_deposit_to_owed.sql — only the caller check changes.

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

  -- A cancelled booking has no live balance to settle — its frozen
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
      insert into public.credits (user_id, booking_id, amount, currency, reason, status, created_by)
      values (v_booking.user_id, c.booking_id, c.amount - v_take, c.currency, c.reason, 'open', c.created_by);
    end if;

    v_remaining := v_remaining - v_take;
  end loop;

  insert into public.payments (user_id, booking_id, amount, status, method, note, recorded_by)
  values (
    v_booking.user_id, p_booking_id, v_apply,
    'paid', 'account_credit', 'Applied account credit', v_caller
  );

  -- Crossing the deposit threshold confirms a pending spot, matching
  -- recordPayment()'s promotion rule.
  v_deposit := coalesce((v_booking.details ->> 'deposit')::numeric, 0);
  -- Against the deposit clamped to what is owed. The deposit is frozen at
  -- booking time and amendments never reduce it, so after a discount it can
  -- exceed the balance — and a diver settling that balance in full would never
  -- cross it, leaving their booking pending forever.
  if v_booking.status = 'pending' and (v_paid + v_apply) >= least(v_deposit, v_owed) then
    update public.bookings set status = 'confirmed' where id = p_booking_id;
  end if;

  return v_apply;
end;
$function$;
