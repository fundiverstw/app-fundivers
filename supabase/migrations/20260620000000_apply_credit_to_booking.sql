-- Let a diver spend their open account credit toward an unpaid booking,
-- and give admins the same operation for any diver. "Applying" credit is
-- two coupled writes that must happen atomically:
--
--   1. consume open credit rows (settle them, oldest first), and
--   2. insert an offsetting payment row (method 'account_credit',
--      status 'paid') against the booking
--
-- Doing only one side would either lose the diver's money or double-count
-- it (the credit balance and the booking's paid sum are computed from the
-- two separate tables). Divers can only SELECT credits/payments under RLS,
-- so the diver-facing path can't run client-side at all — this SECURITY
-- DEFINER function is the single entry point for both surfaces, keeping the
-- consume-and-split rules in one place.
--
-- Mirrors the two-sided audit philosophy already documented in
-- 20260521010000_credits.sql: a credit that's only partly spent is settled
-- in full and the unspent remainder is carried forward as a fresh open
-- credit, so every row stays immutable-ish (open -> settled) and the trail
-- reads cleanly.
--
-- Returns the amount actually applied (clamped to what's owed and what's
-- available), so callers can refetch and toast the real figure.

begin;

create or replace function public.apply_credit_to_booking(
  p_booking_id uuid,
  p_amount     numeric
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
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

  -- A diver may only spend against their own booking; admins, anyone's.
  if v_booking.user_id <> v_caller and not v_is_admin then
    raise exception 'not your booking' using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = 'check_violation';
  end if;

  -- owed = frozen total snapshot + signed amendment ledger.
  v_owed := coalesce((v_booking.details ->> 'total')::numeric, 0)
          + coalesce((select sum(amount) from public.booking_amendments
                      where booking_id = p_booking_id), 0);

  v_paid := coalesce((select sum(amount) from public.payments
                      where booking_id = p_booking_id and status = 'paid'), 0);

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
  if v_booking.status = 'pending' and (v_paid + v_apply) >= v_deposit then
    update public.bookings set status = 'confirmed' where id = p_booking_id;
  end if;

  return v_apply;
end;
$$;

revoke all on function public.apply_credit_to_booking(uuid, numeric) from public;
grant execute on function public.apply_credit_to_booking(uuid, numeric) to authenticated;

commit;
