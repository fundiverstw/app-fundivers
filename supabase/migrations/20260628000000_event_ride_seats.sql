-- ============================================================
-- event_ride_seats — how many shop-ride seats an event has and how many are taken
-- ============================================================
-- The registration form must only offer "Yes, I need a ride" while the event
-- still has free seats in the cars allocated to it (event_vehicles). But a
-- registering diver can read neither event_vehicles (staff/admin only) nor
-- other divers' bookings (self-select only), so the count can't be computed
-- client-side. This SECURITY DEFINER function does it server-side and is
-- callable by any authenticated user — mirroring event_confirmed_counts()
-- (20260514010000_event_capacity.sql), which surfaces remaining capacity the
-- same way.
--
-- capacity = sum of passenger_seats over the DISTINCT vehicles assigned to the
--   event (distinct so a van assigned to several days of a multi-day event
--   counts once). passenger_seats already excludes the driver.
-- claimed  = non-cancelled bookings for the event with details.transportation
--   = true (the divers already holding a ride seat).
-- The caller derives available = max(0, capacity - claimed).

create or replace function public.event_ride_seats(
  p_dive_id uuid default null, p_course_id uuid default null
)
returns table (capacity int, claimed int)
language sql security definer set search_path = public as $$
  select
    coalesce((
      select sum(v.passenger_seats)::int
      from (
        select distinct vehicle_id
        from public.event_vehicles
        where (p_dive_id   is not null and eo_dive_id   = p_dive_id)
           or (p_course_id is not null and eo_course_id = p_course_id)
      ) ev
      join public.vehicles v on v.id = ev.vehicle_id
    ), 0) as capacity,
    coalesce((
      select count(*)::int
      from public.bookings
      where status <> 'cancelled'
        and (details->>'transportation') = 'true'
        and ((p_dive_id   is not null and eo_dive_id   = p_dive_id)
          or (p_course_id is not null and eo_course_id = p_course_id))
    ), 0) as claimed;
$$;

-- Authenticated-only: divers call this from the registration form. Not for anon.
revoke execute on function public.event_ride_seats(uuid, uuid) from public;
grant  execute on function public.event_ride_seats(uuid, uuid) to authenticated;
