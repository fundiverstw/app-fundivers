-- Lead-booker-pays-for-the-group.
--
-- A parent (lead booker) who registers a group that includes their child
-- accounts can be the single payer for the whole group: one consolidated
-- balance on the lead's account, child accounts show "covered by the lead"
-- with no balance of their own, and the admin records one payment that
-- settles the group.
--
-- We model the payer at the per-booking grain via bookings.payer_id, NOT a
-- group-level table — an admin must be able to revert a SINGLE child back to
-- paying their own share without splitting the group. payer_id null = the
-- diver pays their own (status quo); set = the lead is responsible for that
-- booking. For a lead-paid group every sibling (including the lead's own
-- booking) carries payer_id = lead. group_id stays the display-grouping key;
-- correctness keys off payer_id.
--
-- "One payment settles the group" is an atomic SECURITY DEFINER RPC
-- (record_group_payment) that distributes the admin-entered lump across the
-- group's sibling bookings — deposits first so every spot confirms, then
-- remaining balances, oldest first — inserting one ordinary payments row per
-- touched booking. Keeping the distribution server-side and transactional
-- mirrors apply_credit_to_booking and avoids a half-recorded group payment.
--
-- Because children log in directly and we show the lead's real name in the
-- "covered by" line, a child needs to read exactly their own parent's profile
-- row — added as a narrow SELECT policy, routed through a SECURITY DEFINER
-- helper to avoid profiles-policy recursion (same trick as is_admin()).

begin;

-- ============================================================
-- 1. Schema
-- ============================================================

alter table public.bookings
  add column if not exists payer_id uuid
    references public.profiles(id) on delete set null;

create index if not exists bookings_payer_id_idx
  on public.bookings (payer_id)
  where payer_id is not null;

-- ============================================================
-- 2. Validate payer_id
-- ============================================================
-- payer_id, when set, must be either the booking's own diver (a no-op
-- "pays self") or that diver's parent_account. A CHECK can't peek at the
-- parent row, so this is a trigger. It is deliberately authoritative for
-- EVERY writer — the registration edge function inserts via the service role
-- (bypassing RLS), so this trigger is the only guard on that path. No
-- auth.uid() short-circuit.

create or replace function public.bookings_validate_payer()
returns trigger language plpgsql as $$
declare
  v_parent uuid;
begin
  if new.payer_id is not null and new.payer_id <> new.user_id then
    select parent_account into v_parent from public.profiles where id = new.user_id;
    if v_parent is null or v_parent <> new.payer_id then
      raise exception 'payer_id must be the diver themselves or their parent account'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bookings_validate_payer on public.bookings;
create trigger trg_bookings_validate_payer
  before insert or update of payer_id on public.bookings
  for each row execute function public.bookings_validate_payer();

-- ============================================================
-- 3. record_group_payment RPC
-- ============================================================
-- Admin-only. Distributes p_amount across the lead's active bookings
-- (optionally narrowed to one group_id): deposits first (oldest first) so
-- spots confirm, then remaining balances (oldest first). Inserts one paid
-- payments row per touched booking and confirms any pending sibling whose
-- own deposit is now covered (same rule as recordPayment / apply_credit).
-- Returns the amount actually applied (clamped to outstanding balances).

create or replace function public.record_group_payment(
  p_lead     uuid,
  p_amount   numeric,
  p_group_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
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
    v_paid := coalesce((select sum(amount) from public.payments
                        where booking_id = b.id and status = 'paid'), 0);
    v_owed := coalesce((b.details ->> 'total')::numeric, 0)
            + coalesce((select sum(amount) from public.booking_amendments
                        where booking_id = b.id), 0);
    v_due := v_owed - v_paid;
    if v_due <= 0 then continue; end if;
    v_deposit := coalesce((b.details ->> 'deposit')::numeric, 0);
    v_dep_due := least(greatest(v_deposit - v_paid, 0), v_due);
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
    v_paid := coalesce((select sum(amount) from public.payments
                        where booking_id = b.id and status = 'paid'), 0);
    v_owed := coalesce((b.details ->> 'total')::numeric, 0)
            + coalesce((select sum(amount) from public.booking_amendments
                        where booking_id = b.id), 0);
    v_so_far := coalesce((v_alloc ->> b.id::text)::numeric, 0);
    v_due := v_owed - v_paid - v_so_far;
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

    v_paid := coalesce((select sum(amount) from public.payments
                        where booking_id = b.id and status = 'paid'), 0);
    v_deposit := coalesce((b.details ->> 'deposit')::numeric, 0);
    if b.status = 'pending' and v_paid >= v_deposit then
      update public.bookings set status = 'confirmed' where id = b.id;
    end if;
  end loop;

  return v_applied;
end;
$$;

revoke all on function public.record_group_payment(uuid, numeric, uuid) from public;
grant execute on function public.record_group_payment(uuid, numeric, uuid) to authenticated;

-- ============================================================
-- 4. Let a child read their own parent's profile
-- ============================================================
-- Children log in directly and see "covered by [lead name]" on bookings the
-- lead pays for. They need to read exactly the one parent row. Inlining the
-- parent lookup in the policy would re-run RLS on profiles and recurse, so we
-- route it through a SECURITY DEFINER helper (mirrors is_admin()).

create or replace function public.my_parent_account()
returns uuid
language sql stable security definer set search_path = public as $$
  select parent_account from public.profiles where id = auth.uid()
$$;
grant execute on function public.my_parent_account() to authenticated;

drop policy if exists "profiles: child select parent" on public.profiles;
create policy "profiles: child select parent"
  on public.profiles for select to authenticated
  using (id = public.my_parent_account());

commit;
