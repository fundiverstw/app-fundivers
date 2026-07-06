-- Converge (5/7): finish the events table's shape to match fundive — convert
-- its reference columns to uuid, wire the real FKs into the renamed reference
-- tables, add the missing CHECKs/indexes, and convert event_destinations'
-- destination_id to uuid + FK it into travel_destinations. Also add the
-- addon/room junction FKs (the unify pass created these junctions with only the
-- event_id FK).
--
-- Two sets of dangling references are nulled first so the ON DELETE SET NULL FKs
-- validate: one events.divetravel_id with no dive_travel row, and 21
-- events.prereq_cert_id values left dangling by a past cert-relabel migration
-- (EO_dives carried the same stale refs under a validated-but-unchecked FK).

begin;

-- ── events reference columns -> uuid + FKs ───────────────────────────────────
update public.events e set divetravel_id = null
 where divetravel_id is not null
   and not exists (select 1 from public.dive_travel dt where dt.id = e.divetravel_id::uuid);

update public.events e set prereq_cert_id = null
 where prereq_cert_id is not null
   and not exists (select 1 from public.cert_levels c where c.id = e.prereq_cert_id);

alter table public.events alter column cancel_policy type uuid using cancel_policy::uuid;
alter table public.events alter column divetravel_id type uuid using divetravel_id::uuid;

alter table public.events
  add constraint events_price_fkey foreign key (price)
  references public.prices(id) on delete set null;
alter table public.events
  add constraint events_prereq_cert_id_fkey foreign key (prereq_cert_id)
  references public.cert_levels(id) on delete set null;
alter table public.events
  add constraint events_cancel_policy_fkey foreign key (cancel_policy)
  references public.cancellation_policies(id) on update cascade;
alter table public.events
  add constraint events_divetravel_id_fkey foreign key (divetravel_id)
  references public.dive_travel(id) on delete set null;

-- ── events CHECKs (only events_kind_check existed) ───────────────────────────
alter table public.events add constraint events_capacity_check
  check (((capacity is null) or (capacity >= 0)));
alter table public.events add constraint events_course_has_days
  check (((kind <> 'course'::text) or ((course_days is not null)
    and ((array_length(course_days, 1) >= 1) and (array_length(course_days, 1) <= 4)))));
alter table public.events add constraint events_dive_has_start
  check (((kind <> 'dive'::text) or (start_date is not null)));

-- ── events indexes (events_kind_start_idx already present) ───────────────────
create index events_active_idx on public.events using btree (start_date) where (cancelled_at is null);
create index events_course_days_idx on public.events using gin (course_days);
create index events_price_idx on public.events using btree (price);

-- ── event_destinations.destination_id -> uuid + FK ───────────────────────────
alter table public.event_destinations
  alter column destination_id type uuid using destination_id::uuid;
alter table public.event_destinations
  add constraint event_destinations_destination_id_fkey foreign key (destination_id)
  references public.travel_destinations(id) on delete cascade;

-- ── addon/room junction FKs into the renamed reference tables ────────────────
alter table public.event_addons
  add constraint event_addons_addon_id_fkey foreign key (addon_id)
  references public.addons(id) on delete cascade;
alter table public.event_rooms
  add constraint event_rooms_room_id_fkey foreign key (room_id)
  references public.rooms(id) on delete cascade;

commit;

notify pgrst, 'reload schema';
