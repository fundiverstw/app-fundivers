-- Shared transport between events ("runs").
--
-- Two events on the same day sometimes travel together — same site, one van —
-- and sometimes cannot, because they are at different sites. Nothing in the
-- schema said which, so every ride calculation treated each event as its own
-- island and the day view added the islands up. That produced numbers that were
-- wrong in both directions:
--
--   * A van assigned to two events was counted twice. Its 8 seats became 16,
--     and the planner would happily seat 12 bodies in it.
--   * A day's "seats vs riders" line pooled unrelated runs, so slack in the
--     course's car looked like slack for the boat dive's divers.
--   * A diver booked on two of the day's events counted as two riders; a staff
--     member on duty for two events was seated in the first and silently
--     dropped from the second event's demand.
--
-- The fix is an explicit, admin-curated grouping: the events that ride
-- together on a given day share a group_id. Everything else — seats, riders,
-- who's aboard, what's left over — is then computed per group, counting each
-- physical car and each person exactly once.
--
-- One row per (day, event) that rides in company. An event with no row rides
-- alone. group_id is a bare uuid with no parent table: a group *is* the set of
-- rows sharing it, so removing the last member leaves nothing behind to clean
-- up.

create table public.event_ride_groups (
  ride_day date not null,
  event_id uuid not null references public.events(id) on delete cascade,
  group_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  primary key (ride_day, event_id)
);

create index event_ride_groups_day_group_idx
  on public.event_ride_groups using btree (ride_day, group_id);

alter table public.event_ride_groups enable row level security;

-- Same access shape as event_vehicles, which this sits beside: staff read the
-- plan, admins curate it.
create policy "event_ride_groups: staff_or_admin read" on public.event_ride_groups
  for select to authenticated using (public.is_staff_or_admin());
create policy "event_ride_groups: admin manage" on public.event_ride_groups
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── event_ride_seats: group-aware, and no phantom driver seat ───────────────
--
-- Two changes to what a diver is offered on the registration form.
--
-- 1. Runs. Capacity and claims are now measured across the whole run the event
--    rides in, with cars deduplicated by vehicle: a van serving both events of
--    a run contributes its seats once, and a diver booked on both events of a
--    run claims one seat, not two. An event that rides alone is a run of one,
--    which is exactly the old behaviour.
--
-- 2. Crew seats. The old formula subtracted `greatest(#cars, #staff)` — one
--    reserved driver seat per vehicle, or the staff, whichever was larger. The
--    app has no driver concept (nobody is assigned to a wheel, and
--    vehicles.passenger_seats is the count of physical seats), and the admin
--    logistics planner has always seated staff into ordinary seats. The two
--    surfaces therefore disagreed: a diver could be refused a seat the admin
--    board showed as free. Subtract the on-duty staff, who really do ride, and
--    nothing else.
--
-- When an event rides in a group on several days, the tightest of those days
-- wins — the gate must not promise a seat that one leg of the trip cannot
-- supply. Days on which a multi-day event happens not to be grouped are not
-- considered: the grouped days are the ones an admin curated, and folding in a
-- solo day would zero out the capacity of an event that legitimately rides in a
-- partner's van.
-- The return type gains `seats` and `staff`, so an admin surface can show the
-- honest breakdown ("8 seats, 2 of them staff") instead of re-deriving it from
-- data it may not have. Widening a RETURNS TABLE needs a drop first.
drop function if exists public.event_ride_seats(uuid);

create function public.event_ride_seats(p_event_id uuid)
  returns table(seats integer, staff integer, capacity integer, claimed integer)
  language sql
  security definer
  set search_path to 'public'
  as $$
  with my_groups as (
    select g.ride_day, g.group_id
    from public.event_ride_groups g
    where g.event_id = p_event_id
      -- Only days the event actually runs on. A grouping row survives an event
      -- being rescheduled (nothing rewrites its ride_day), and pooling seats
      -- with a run the event no longer joins would inflate its capacity. Asked
      -- by date SHAPE, not by kind: a course-day list, or a start/end envelope.
      and exists (
        select 1 from public.events e
        where e.id = g.event_id
          and (
            (e.course_days is not null and g.ride_day = any(e.course_days))
            or (e.start_date is not null
                and g.ride_day between e.start_date and coalesce(e.end_date, e.start_date))
          )
      )
  ),
  -- Every (day, event) pair that shares a run with this event. The union's
  -- second branch is the rides-alone case: a null day means "this event on its
  -- own", where duty dates are not filtered (the event's whole duty roster
  -- rides, as before).
  runs as (
    select mg.ride_day, peer.event_id
    from my_groups mg
    join public.event_ride_groups peer
      on peer.ride_day = mg.ride_day and peer.group_id = mg.group_id
    union
    select null::date, p_event_id
    where not exists (select 1 from my_groups)
  ),
  run_days as (select distinct ride_day from runs),
  tally as (
    select
      rd.ride_day,
      coalesce((
        select sum(v.passenger_seats)::int
        from (
          select distinct ev.vehicle_id
          from public.event_vehicles ev
          join runs r on r.event_id = ev.event_id
                     and r.ride_day is not distinct from rd.ride_day
        ) c
        join public.vehicles v on v.id = c.vehicle_id
      ), 0) as seats,
      coalesce((
        select count(distinct d.assignee_id)::int
        from public.duties d
        join runs r on r.event_id = d.event_id
                   and r.ride_day is not distinct from rd.ride_day
        where rd.ride_day is null
           or (d.start_date <= rd.ride_day
               and (d.end_date is null or d.end_date >= rd.ride_day))
      ), 0) as staff,
      coalesce((
        select count(distinct b.user_id)::int
        from public.bookings b
        join runs r on r.event_id = b.event_id
                   and r.ride_day is not distinct from rd.ride_day
        where b.status <> 'cancelled'
          and (b.details->>'transportation') = 'true'
      ), 0) as claimed
    from run_days rd
  )
  select t.seats, t.staff, greatest(0, t.seats - t.staff) as capacity, t.claimed
  from tally t
  order by (greatest(0, t.seats - t.staff) - t.claimed) asc,
           greatest(0, t.seats - t.staff) asc
  limit 1;
$$;

alter function public.event_ride_seats(uuid) owner to postgres;
revoke all on function public.event_ride_seats(uuid) from public, anon;
grant execute on function public.event_ride_seats(uuid) to authenticated, service_role;
