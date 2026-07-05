-- ============================================================
-- event_ride_seats — reserve one driver seat per assigned vehicle
-- ============================================================
-- vehicles.passenger_seats was redefined to a vehicle's TOTAL physical seats
-- (the "Physical seats" relabel + the removal of driver assignment). Someone
-- still has to drive each van, occupying one of those seats, so the ride-claim
-- capacity must reserve one seat per assigned vehicle. Otherwise divers can
-- claim every physical seat and the logistics ride planner — which also seats
-- on-duty staff — leaves a diver who was already promised a ride unseated.
--
-- Supersedes the capacity clause in 20260628000000_event_ride_seats.sql:
--   capacity = max(0, sum(passenger_seats) - count(distinct vehicles)) over the
--     vehicles assigned to the event.
-- claimed and the grants are unchanged.

begin;

create or replace function public.event_ride_seats(
  p_dive_id uuid default null, p_course_id uuid default null
)
returns table (capacity int, claimed int)
language sql security definer set search_path = public as $$
  select
    coalesce((
      select greatest(0, sum(v.passenger_seats)::int - count(*)::int)
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

commit;

notify pgrst, 'reload schema';
