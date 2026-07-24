-- Stop trusting the client's `details.ride_waitlisted`.
--
-- When a diver asks for a ride on a run with no free seat, the booking still
-- goes through — flagged `ride_waitlisted`, which fires the "add a car" notice
-- to admins (notify_admins_ride_waitlist). That flag was computed in the
-- browser from the same RPC the "N ride seats left" hint uses, and sent along
-- with the rest of details. A crafted request could therefore claim a ride on a
-- full run with `ride_waitlisted: false` and the shop would never be told: the
-- diver looks like they hold a seat that does not exist. The mirror case is
-- just as bad — `ride_waitlisted: true` with no ride requested at all spams
-- every admin about a ride nobody asked for.
--
-- So the database decides, on insert and on any details edit, exactly as it
-- already decides `status = 'waitlisted'` when an event is full
-- (set_waitlisted_when_event_full). The client's value is overwritten, not
-- consulted; the forms still compute it for what they show the diver.

-- The seat tally as a reusable workhorse, so the trigger and the diver-facing
-- RPC can never drift apart. `p_exclude_user` drops one diver's claims from
-- `claimed`, which is how a booking asks "is there a seat for ME" without
-- counting a seat it already holds elsewhere on the run.
create function public.event_ride_tally(p_event_id uuid, p_exclude_user uuid)
  returns table(seats integer, staff integer, capacity integer, claimed integer)
  language sql
  security definer
  set search_path to 'public'
  as $$
  with my_groups as (
    select g.ride_day, g.group_id
    from public.event_ride_groups g
    where g.event_id = p_event_id
      -- Only days the event actually runs on; see 20260724000000.
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
          and (p_exclude_user is null or b.user_id <> p_exclude_user)
      ), 0) as claimed
    from run_days rd
  )
  select t.seats, t.staff, greatest(0, t.seats - t.staff) as capacity, t.claimed
  from tally t
  order by (greatest(0, t.seats - t.staff) - t.claimed) asc,
           greatest(0, t.seats - t.staff) asc
  limit 1;
$$;

alter function public.event_ride_tally(uuid, uuid) owner to postgres;
-- Internal: the trigger below and the service role only. The diver-facing
-- entry point is event_ride_seats, which cannot be asked about other divers.
revoke all on function public.event_ride_tally(uuid, uuid) from public, anon, authenticated;
grant execute on function public.event_ride_tally(uuid, uuid) to service_role;

create or replace function public.event_ride_seats(p_event_id uuid)
  returns table(seats integer, staff integer, capacity integer, claimed integer)
  language sql
  security definer
  set search_path to 'public'
  as $$
  select * from public.event_ride_tally(p_event_id, null);
$$;

alter function public.event_ride_seats(uuid) owner to postgres;
revoke all on function public.event_ride_seats(uuid) from public, anon;
grant execute on function public.event_ride_seats(uuid) to authenticated, service_role;

create function public.bookings_set_ride_waitlist() returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
  as $$
declare
  v_capacity    int;
  v_claimed_all int;
  v_claimed_others int;
begin
  -- No ride requested → the flag has no meaning. Strip it so a stray `true`
  -- can't notify admins about a ride nobody asked for.
  if coalesce(new.details->>'transportation', '') <> 'true' then
    new.details := (coalesce(new.details, '{}'::jsonb)) - 'ride_waitlisted';
    return new;
  end if;

  if new.event_id is null then
    new.details := jsonb_set(new.details, '{ride_waitlisted}', 'false'::jsonb);
    return new;
  end if;

  select t.capacity, t.claimed into v_capacity, v_claimed_others
  from public.event_ride_tally(new.event_id, new.user_id) t;
  select t.claimed into v_claimed_all
  from public.event_ride_tally(new.event_id, null) t;

  -- A diver already holding a ride somewhere on this run keeps it: a second
  -- booking on the same run is the same body in the same seat, and the two
  -- tallies differing by their own claim is how we know. Otherwise it comes
  -- down to whether the others have left a seat.
  new.details := jsonb_set(
    new.details, '{ride_waitlisted}',
    to_jsonb(
      coalesce(v_claimed_all, 0) <= coalesce(v_claimed_others, 0)
      and coalesce(v_capacity, 0) - coalesce(v_claimed_others, 0) <= 0
    )
  );
  return new;
end;
$$;

alter function public.bookings_set_ride_waitlist() owner to postgres;

-- BEFORE the AFTER-trigger that notifies admins, so it sees the corrected flag.
create trigger trg_bookings_set_ride_waitlist
  before insert or update of details on public.bookings
  for each row execute function public.bookings_set_ride_waitlist();
