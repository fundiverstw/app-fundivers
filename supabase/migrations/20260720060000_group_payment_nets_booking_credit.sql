-- Net a booking's own open credit out of a group payment.
--
-- apply_credit_to_booking already subtracts the credit tied to a booking
-- before deciding what is due (`v_self_cred`), because that credit offsets the
-- balance on every surface the diver and admin see. record_group_payment did
-- not: a lead booker paying the full `details.total` for a member whose
-- booking carried an open credit had the whole amount taken in cash, and the
-- member was left showing a credit balance for money the shop had just
-- collected. The two RPCs now agree with each other and with
-- bookingBalance(owed, paid, credit).

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

    insert into public.payments (user_id, booking_id, amount, status, method, note, recorded_by)
    values (b.user_id, b.id, v_take, 'paid', v_method, 'Group payment', v_caller);
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
