-- Stage 2 (expand) — events-centric junctions, backfilled from the eo_* ones.
-- addon/room/destination ids stay TEXT (they point at the Bubble text _id on
-- Other_Addons / EO_rooms / TravelDestinations); the reference-table → uuid
-- stage converts these later. event_id is the new events.id, mapped via
-- events.legacy_id = the source eo_dive_id / eo_course_id.

begin;

create table if not exists public.event_addons (
  event_id uuid not null references public.events(id) on delete cascade,
  addon_id uuid not null,
  primary key (event_id, addon_id)
);
create table if not exists public.event_rooms (
  event_id uuid not null references public.events(id) on delete cascade,
  room_id  uuid not null,
  primary key (event_id, room_id)
);
create table if not exists public.event_destinations (
  event_id       uuid not null references public.events(id) on delete cascade,
  destination_id text not null,
  primary key (event_id, destination_id)
);

insert into public.event_addons (event_id, addon_id)
select e.id, j.addon_id from public.eo_dive_addons j join public.events e on e.legacy_id = j.eo_dive_id
union
select e.id, j.addon_id from public.eo_course_addons j join public.events e on e.legacy_id = j.eo_course_id
on conflict do nothing;

insert into public.event_rooms (event_id, room_id)
select e.id, j.room_id from public.eo_dive_rooms j join public.events e on e.legacy_id = j.eo_dive_id
on conflict do nothing;

insert into public.event_destinations (event_id, destination_id)
select e.id, j.destination_id from public.eo_dive_destinations j join public.events e on e.legacy_id = j.eo_dive_id
on conflict do nothing;

commit;

notify pgrst, 'reload schema';
