-- Converge (1/7): rewrite the event-capacity / waitlist / ride-seat / waiver
-- functions off the split EO_dives/EO_courses model onto the unified events
-- (event_id + kind) model, porting fundive's baseline definitions. Six RPCs
-- change signature (drop + recreate); the trigger functions keep their
-- signatures (create or replace). set_event_relations is new — it replaces the
-- CSV-sync triggers the event form used to lean on.
--
-- The display-title normalize trigger (eo_event_normalize_display_title) is
-- retargeted onto events in a later migration, after EO_dives/EO_courses are
-- dropped, so it is deliberately left alone here.

begin;

-- ── Drop the old split-model signatures ──────────────────────────────────────
drop function if exists public.event_confirmed_count_one(text, uuid);
drop function if exists public.event_confirmed_counts(uuid[], uuid[]);
drop function if exists public.event_ride_seats(uuid, uuid);
drop function if exists public.offer_next_waitlist_spot(uuid, text);
drop function if exists public.refresh_event_display_title(text, uuid);
drop function if exists public.sign_waiver(text, integer, text, uuid, uuid);

-- ── Recreate on the unified event_id model (fundive baseline) ─────────────────
create function public.event_confirmed_count_one(p_event_id uuid) returns integer
    language sql stable security definer set search_path to 'public'
    as $$
  select count(*)::int from public.bookings
  where status = 'confirmed' and event_id = p_event_id;
$$;

create function public.event_confirmed_counts(p_event_ids uuid[])
    returns table(event_id uuid, n integer)
    language sql security definer set search_path to 'public'
    as $$
  select event_id, count(*)::int
  from public.bookings
  where status = 'confirmed' and event_id = any(coalesce(p_event_ids, '{}'::uuid[]))
  group by event_id;
$$;

-- Event-level fleet + crew-reserve body (matches app-fundivers: event_vehicles
-- keyed by event_id, no per-date rows).
create function public.event_ride_seats(p_event_id uuid)
    returns table(capacity integer, claimed integer)
    language sql security definer set search_path to 'public'
    as $$
  with fleet as (
    select v.passenger_seats
    from (select distinct vehicle_id from public.event_vehicles where event_id = p_event_id) ev
    join public.vehicles v on v.id = ev.vehicle_id
  ),
  crew as (
    select count(distinct assignee_id)::int as staff_count
    from public.duties
    where event_id = p_event_id
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
        and event_id = p_event_id
    ), 0) as claimed;
$$;

create function public.offer_next_waitlist_spot(p_event_id uuid) returns uuid
    language plpgsql security definer set search_path to 'public'
    as $$
declare
  v_booking_id uuid;
  v_offer_id   uuid;
begin
  select b.id into v_booking_id
  from public.bookings b
  where b.status = 'waitlisted' and b.event_id = p_event_id
    and not exists (select 1 from public.waitlist_offers o where o.booking_id = b.id and o.status = 'pending')
  order by b.created_at asc
  limit 1;
  if v_booking_id is null then return null; end if;
  insert into public.waitlist_offers (booking_id) values (v_booking_id)
    on conflict (booking_id) where status = 'pending' do nothing
  returning id into v_offer_id;
  return v_offer_id;
end;
$$;

create function public.refresh_event_display_title(p_event_id uuid) returns void
    language plpgsql security definer set search_path to 'public'
    as $$
declare
  v_current   text;
  v_capacity  int;
  v_fully     boolean;
  v_confirmed int;
  v_new_title text;
begin
  if p_event_id is null then return; end if;
  select display_title, capacity, coalesce(fully_booked, false)
    into v_current, v_capacity, v_fully
  from public.events where id = p_event_id;
  if v_current is null and v_capacity is null and not v_fully then return; end if;
  v_confirmed := public.event_confirmed_count_one(p_event_id);
  v_new_title := public.strip_capacity_suffix(coalesce(v_current, ''))
              || public.capacity_suffix(v_capacity, v_fully, v_confirmed);
  update public.events set display_title = v_new_title
   where id = p_event_id and display_title is distinct from v_new_title;
end;
$$;

create function public.sign_waiver(p_code text, p_version integer, p_signed_name text, p_event_id uuid default null::uuid) returns uuid
    language plpgsql security definer set search_path to 'public'
    as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'must be authenticated' using errcode = 'insufficient_privilege'; end if;
  if p_code is null or char_length(p_code) = 0 then raise exception 'waiver code is required' using errcode = 'check_violation'; end if;
  if p_version is null or p_version < 1 then raise exception 'waiver version must be a positive integer' using errcode = 'check_violation'; end if;
  if p_signed_name is null or char_length(btrim(p_signed_name)) = 0 then raise exception 'signed name is required' using errcode = 'check_violation'; end if;

  insert into public.waiver_signatures
    (diver_id, waiver_code, waiver_version, signed_name, signed_at, event_id)
  values
    (auth.uid(), p_code, p_version, btrim(p_signed_name), now(), p_event_id)
  returning id into new_id;
  return new_id;
end;
$$;

-- New RPC the event form calls to atomically resync a single event's relations;
-- replaces the per-EO-row CSV-sync triggers.
create function public.set_event_relations(p_event_id uuid, p_room_ids uuid[] default '{}'::uuid[], p_addon_ids uuid[] default '{}'::uuid[], p_destination_ids uuid[] default '{}'::uuid[]) returns void
    language plpgsql set search_path to 'public'
    as $$
begin
  delete from public.event_rooms where event_id = p_event_id;
  insert into public.event_rooms (event_id, room_id)
    select p_event_id, unnest(p_room_ids) on conflict do nothing;

  delete from public.event_addons where event_id = p_event_id;
  insert into public.event_addons (event_id, addon_id)
    select p_event_id, unnest(p_addon_ids) on conflict do nothing;

  delete from public.event_destinations where event_id = p_event_id;
  insert into public.event_destinations (event_id, destination_id)
    select p_event_id, unnest(p_destination_ids) on conflict do nothing;
end;
$$;

alter function public.event_confirmed_count_one(uuid) owner to postgres;
alter function public.event_confirmed_counts(uuid[]) owner to postgres;
alter function public.event_ride_seats(uuid) owner to postgres;
alter function public.offer_next_waitlist_spot(uuid) owner to postgres;
alter function public.refresh_event_display_title(uuid) owner to postgres;
alter function public.sign_waiver(text, integer, text, uuid) owner to postgres;
alter function public.set_event_relations(uuid, uuid[], uuid[], uuid[]) owner to postgres;

-- ── Trigger functions: retarget onto event_id (signatures unchanged) ─────────
create or replace function public.accept_waitlist_offer(p_offer_id uuid) returns void
    language plpgsql security definer set search_path to 'public'
    as $$
declare
  v_booking_id uuid;
  v_user_id    uuid;
  v_status     text;
  v_expires_at timestamptz;
  v_event_id   uuid;
  v_capacity   int;
  v_taken      int;
begin
  select o.booking_id, b.user_id, o.status, o.expires_at, b.event_id
    into v_booking_id, v_user_id, v_status, v_expires_at, v_event_id
  from public.waitlist_offers o
  join public.bookings b on b.id = o.booking_id
  where o.id = p_offer_id;

  if v_booking_id is null then raise exception 'offer not found'; end if;
  if v_user_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_status <> 'pending' then raise exception 'offer is no longer pending (status=%)', v_status; end if;
  if v_expires_at < now() then raise exception 'offer has expired'; end if;

  if v_event_id is not null then
    select capacity into v_capacity from public.events where id = v_event_id;
    select count(*) into v_taken from public.bookings
      where event_id = v_event_id and status in ('pending', 'confirmed');
  end if;
  if v_capacity is not null and v_taken >= v_capacity then
    raise exception 'event is at capacity (% of %); offer cannot be accepted', v_taken, v_capacity
      using errcode = 'check_violation';
  end if;

  update public.waitlist_offers set status = 'accepted' where id = p_offer_id;
  update public.bookings        set status = 'pending'  where id = v_booking_id;
end;
$$;

create or replace function public.handle_booking_cancellation() returns trigger
    language plpgsql security definer set search_path to 'public'
    as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.waitlist_offers set status = 'expired'
     where booking_id = new.id and status = 'pending';
    if old.status in ('pending', 'confirmed') and new.event_id is not null then
      perform public.offer_next_waitlist_spot(new.event_id);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.set_waitlisted_when_event_full() returns trigger
    language plpgsql
    as $$
declare
  v_full      boolean := false;
  v_capacity  int;
  v_confirmed int;
begin
  if new.status = 'pending' and new.event_id is not null then
    select coalesce(fully_booked, false), capacity into v_full, v_capacity
      from public.events where id = new.event_id;
    if not v_full and v_capacity is not null then
      select count(*)::int into v_confirmed
        from public.bookings where status = 'confirmed' and event_id = new.event_id;
      if v_confirmed >= v_capacity then v_full := true; end if;
    end if;
    if v_full then new.status := 'waitlisted'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.trg_bookings_refresh_event_title() returns trigger
    language plpgsql security definer set search_path to 'public'
    as $$
begin
  if TG_OP = 'INSERT' then
    if new.event_id is not null then perform public.refresh_event_display_title(new.event_id); end if;
  elsif TG_OP = 'UPDATE' then
    if new.status is distinct from old.status then
      if coalesce(new.event_id, old.event_id) is not null then
        perform public.refresh_event_display_title(coalesce(new.event_id, old.event_id));
      end if;
    end if;
  elsif TG_OP = 'DELETE' then
    if old.event_id is not null then perform public.refresh_event_display_title(old.event_id); end if;
  end if;
  return null;
end;
$$;

create or replace function public.notify_admins_ride_waitlist() returns trigger
    language plpgsql security definer set search_path to 'public'
    as $$
declare
  v_event_id text;
  v_title    text;
  v_diver    text;
  v_body     text;
begin
  if coalesce(new.details->>'ride_waitlisted', '') <> 'true' then
    return new;
  end if;
  if coalesce(new.status, '') = 'cancelled' then
    return new;
  end if;
  if tg_op = 'UPDATE' and coalesce(old.details->>'ride_waitlisted', '') = 'true' then
    return new;
  end if;

  v_event_id := new.event_id::text;
  select coalesce(display_title, admin_title) into v_title
  from public.events where id = new.event_id;

  select nullif(trim(name), '') into v_diver
  from public.profiles where id = new.user_id;

  v_body := coalesce(v_diver, 'A diver')
    || ' requested a ride for ' || coalesce(v_title, 'an event')
    || ', but the shop ride is full — add a car or arrange transport.';

  insert into public.notifications (user_id, title, body, url, kind, event_id)
  select p.id, 'Ride waitlist request', v_body, '/admin/logistics', 'ride_waitlist', v_event_id
  from public.profiles p
  where p.role = 'admin';

  return new;
end;
$$;

drop trigger if exists notify_admins_ride_waitlist_trg on public.bookings;
create trigger notify_admins_ride_waitlist_trg
  after insert or update on public.bookings
  for each row execute function public.notify_admins_ride_waitlist();

-- ── Grants (fundive baseline; event_ride_seats stays authenticated-only) ─────
grant execute on function public.event_confirmed_count_one(uuid) to anon, authenticated, service_role;
grant execute on function public.event_confirmed_counts(uuid[]) to anon, authenticated, service_role;
grant execute on function public.offer_next_waitlist_spot(uuid) to anon, authenticated, service_role;
grant execute on function public.refresh_event_display_title(uuid) to anon, authenticated, service_role;
grant execute on function public.sign_waiver(text, integer, text, uuid) to anon, authenticated, service_role;
grant execute on function public.set_event_relations(uuid, uuid[], uuid[], uuid[]) to anon, authenticated, service_role;

revoke execute on function public.event_ride_seats(uuid) from public, anon;
grant  execute on function public.event_ride_seats(uuid) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
