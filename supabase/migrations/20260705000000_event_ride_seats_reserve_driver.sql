-- ============================================================
-- event_ride_seats — reserve seats for the crew who ride the fleet
-- ============================================================
-- vehicles.passenger_seats was redefined to a vehicle's TOTAL physical seats
-- (the "Physical seats" relabel + the removal of driver assignment). The whole
-- crew still travels in the fleet: every on-duty staff member rides (one of
-- them drives each van), each taking a seat. So the seats a diver can claim are
-- the physical seats MINUS the crew's seats. Otherwise divers can claim seats
-- the logistics ride planner (which seats staff first) hands to staff, leaving
-- a diver who was already promised a ride unseated.
--
-- Supersedes the capacity clause in 20260628000000_event_ride_seats.sql:
--   reserved = greatest(#vehicles, #on-duty staff)
--     — one driver per van as a floor (robust before duties are assigned),
--       rising to the full staff count once staff outnumber the vans.
--   capacity = greatest(0, sum(passenger_seats) - reserved)
-- claimed and the grants are unchanged.

begin;

create or replace function public.event_ride_seats(
  p_dive_id uuid default null, p_course_id uuid default null
)
returns table (capacity int, claimed int)
language sql security definer set search_path = public as $$
  with fleet as (
    select v.passenger_seats
    from (
      select distinct vehicle_id
      from public.event_vehicles
      where (p_dive_id   is not null and eo_dive_id   = p_dive_id)
         or (p_course_id is not null and eo_course_id = p_course_id)
    ) ev
    join public.vehicles v on v.id = ev.vehicle_id
  ),
  crew as (
    select count(distinct assignee_id)::int as staff_count
    from public.duties
    where (p_dive_id   is not null and eo_dive_id   = p_dive_id)
       or (p_course_id is not null and eo_course_id = p_course_id)
  )
  select
    greatest(
      0,
      coalesce((select sum(passenger_seats)::int from fleet), 0)
        - greatest(
            (select count(*)::int from fleet),
            (select staff_count from crew)
          )
    ) as capacity,
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
