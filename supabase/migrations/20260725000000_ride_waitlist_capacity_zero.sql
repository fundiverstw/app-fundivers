-- A run with no rideable seat at all means ride capacity has not been set up
-- yet, not that the ride is full. Without this branch the trigger from
-- 20260724000000 treats capacity 0 like a full run and flags the booking
-- ride_waitlisted, paging admins to "add a car" for an event that has none
-- assigned. The form now offers the ride at capacity 0 too (canRequestRide in
-- src/lib/event-vehicles.ts returns true at capacity 0, so a shop can take
-- bookings and plan the van later), so let it through here without flagging.
-- A shop that would rather block early sets the opposite in canRequestRide and
-- drops this branch. Redefines the trigger function only; the trigger itself is
-- unchanged.

create or replace function public.bookings_set_ride_waitlist() returns trigger
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

  -- No rideable seat on the run at all means ride capacity has not been set up
  -- yet, not that the ride is full. FunDive's default is to let that through
  -- (canRequestRide in src/lib/event-vehicles.ts returns true at capacity 0, so
  -- a shop can take bookings and plan the van later) — so nothing is flagged and
  -- nobody is paged. A shop that would rather block early sets the opposite in
  -- canRequestRide and drops this branch.
  if coalesce(v_capacity, 0) <= 0 then
    new.details := jsonb_set(new.details, '{ride_waitlisted}', 'false'::jsonb);
    return new;
  end if;

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
