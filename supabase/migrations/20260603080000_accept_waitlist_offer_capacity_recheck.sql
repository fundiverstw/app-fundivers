-- L9 — re-check event capacity inside accept_waitlist_offer.
--
-- Previously the RPC validated the offer (pending, unexpired, owned
-- by caller) and flipped the booking back to 'pending', but never
-- re-checked whether the underlying event still had capacity. Two
-- waitlisters racing the same last spot would both succeed and the
-- event would end up over its cap. Today this is masked by the
-- admin manually moving 'pending' → 'confirmed', but the moment a
-- future auto-confirm path lands the over-cap becomes silent.
--
-- Fix: look up the booking's event (eo_dive_id XOR eo_course_id),
-- read the capacity, count active (pending + confirmed) bookings,
-- and refuse the accept if the event would be over its cap. Null
-- capacity (uncapped event) skips the check.
--
-- Search_path was pinned in 20260603050000 and is preserved.

begin;

create or replace function public.accept_waitlist_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id  uuid;
  v_user_id     uuid;
  v_status      text;
  v_expires_at  timestamptz;
  v_dive_id     uuid;
  v_course_id   uuid;
  v_capacity    int;
  v_taken       int;
begin
  select o.booking_id, b.user_id, o.status, o.expires_at,
         b.eo_dive_id, b.eo_course_id
    into v_booking_id, v_user_id, v_status, v_expires_at,
         v_dive_id,    v_course_id
  from public.waitlist_offers o
  join public.bookings b on b.id = o.booking_id
  where o.id = p_offer_id;

  if v_booking_id is null then
    raise exception 'offer not found';
  end if;
  if v_user_id is distinct from auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_status <> 'pending' then
    raise exception 'offer is no longer pending (status=%)', v_status;
  end if;
  if v_expires_at < now() then
    raise exception 'offer has expired';
  end if;

  -- Re-check capacity. If the event has none defined, treat as
  -- uncapped. Otherwise sum pending + confirmed bookings (i.e.
  -- everyone who counts toward the cap) and refuse the accept if
  -- adding this one would push us over.
  if v_dive_id is not null then
    select capacity into v_capacity from public."EO_dives" where _id = v_dive_id;
    select count(*) into v_taken
      from public.bookings
      where eo_dive_id = v_dive_id and status in ('pending', 'confirmed');
  elsif v_course_id is not null then
    select capacity into v_capacity from public."EO_courses" where _id = v_course_id;
    select count(*) into v_taken
      from public.bookings
      where eo_course_id = v_course_id and status in ('pending', 'confirmed');
  end if;

  if v_capacity is not null and v_taken >= v_capacity then
    raise exception 'event is at capacity (% of %); offer cannot be accepted', v_taken, v_capacity
      using errcode = 'check_violation';
  end if;

  update public.waitlist_offers set status = 'accepted' where id = p_offer_id;
  update public.bookings        set status = 'pending'  where id = v_booking_id;
end;
$$;

commit;
