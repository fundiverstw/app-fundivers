-- Drop EO_prices.room_options and add a proper FK-enforced junction
-- table for EO_dives.room_types.
--
-- Until now:
--   * EO_prices.room_options held a JSON array of EO_rooms._id values
--     (only ever read by the inline price-tier sub-form on the admin
--     event page). Going forward, room availability for an event is
--     sourced from EO_dives.room_types only — so this column is dead
--     weight and we drop it.
--
--   * EO_dives.room_types is a CSV text column of EO_rooms._id values
--     with no FK enforcement. We mirror the existing eo_dive_addons
--     pattern (20260422220000_event_addons_junction.sql): keep the
--     text column as the write buffer (so the form's existing CSV
--     write path keeps working) and a trigger reconciles a junction
--     table whose FKs to EO_rooms enforce integrity. The SPA reads
--     from the junction.
--
-- Course rooms aren't in scope — EO_courses has no room_types column;
-- per docs/data-model.md, courses don't carry room options. (If that
-- ever changes, add a parallel eo_course_rooms here.)

begin;

-- 1. Drop EO_prices.room_options. The inline price-tier sub-form on
--    /admin/new/event still reads the value at write time but always
--    overwrites it; once the column is gone the form will be updated
--    in the same patch to stop touching it.
alter table public."EO_prices" drop column if exists room_options;

-- 2. Junction table — FKs cascade so a deleted dive / room cleans up
--    its rows automatically, matching eo_dive_addons exactly.
create table if not exists public.eo_dive_rooms (
  eo_dive_id uuid not null references public."EO_dives"(_id) on delete cascade,
  room_id    uuid not null references public."EO_rooms"(_id) on delete cascade,
  primary key (eo_dive_id, room_id)
);

create index if not exists eo_dive_rooms_room_idx
  on public.eo_dive_rooms (room_id);

-- 3. CSV → junction parser. room_types is always plain comma-separated
--    UUIDs (the form writes form.roomIds.join(',')); no JSON branch
--    needed, unlike parse_addon_ids.
create or replace function public.parse_room_ids(raw text) returns setof uuid
  language plpgsql immutable as $$
declare
  stripped text;
begin
  if raw is null then return; end if;
  stripped := btrim(raw);
  if stripped = '' then return; end if;
  return query
    select btrim(tok)::uuid
    from unnest(string_to_array(stripped, ',')) tok
    where btrim(tok) ~ '^[0-9a-f-]{36}$';
end;
$$;

-- 4. Backfill. Skip orphans (FK would reject them anyway).
insert into public.eo_dive_rooms (eo_dive_id, room_id)
select d._id, elem
from public."EO_dives" d
cross join lateral public.parse_room_ids(d.room_types) as elem
where exists (select 1 from public."EO_rooms" r where r._id = elem)
on conflict do nothing;

-- 5. Sync trigger — DELETE-then-reinsert keeps the logic trivially
--    correct on every room_types update.
create or replace function public.sync_eo_dive_rooms() returns trigger
  language plpgsql as $$
begin
  delete from public.eo_dive_rooms where eo_dive_id = new._id;
  insert into public.eo_dive_rooms (eo_dive_id, room_id)
  select new._id, elem
  from public.parse_room_ids(new.room_types) as elem
  where exists (select 1 from public."EO_rooms" r where r._id = elem)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists sync_eo_dive_rooms_trg on public."EO_dives";
create trigger sync_eo_dive_rooms_trg
  after insert or update of room_types on public."EO_dives"
  for each row execute function public.sync_eo_dive_rooms();

-- 6. Junction needs no RLS policy of its own — it's auto-reconciled
--    by the trigger that fires under the writer's privileges (admin
--    update on EO_dives via the existing "EO_dives: admin update"
--    policy). Leaving RLS disabled mirrors eo_dive_addons.

notify pgrst, 'reload schema';

commit;
