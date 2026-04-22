-- Normalize the Wix-style "multi-reference" `other_addons` column into
-- proper junction tables. Each `EO_dives`/`EO_courses` row already stores a
-- JSON array of addon IDs in its `other_addons` text column; we keep that
-- column as the Bubble-sync buffer (so re-imports still work) and mirror
-- its contents into these junction tables via a trigger. The app reads from
-- the junction tables, giving us real FK enforcement + clean joins.
--
-- Cloud data is not uniformly JSON — some rows hold a bare UUID or a CSV
-- string. `parse_addon_ids` matches the tolerant parse already used by the
-- client (src/lib/events.ts::parseJsonIds): try JSON first, fall back to
-- CSV-split, return nothing for empty/garbage input.

begin;

create or replace function public.parse_addon_ids(raw text) returns setof text
  language plpgsql immutable as $$
declare
  stripped text;
begin
  if raw is null then return; end if;
  stripped := btrim(raw);
  if stripped = '' then return; end if;

  if left(stripped, 1) = '[' then
    begin
      return query select value from jsonb_array_elements_text(stripped::jsonb);
      return;
    exception when others then
      -- malformed JSON → fall through to CSV
    end;
  end if;

  return query
    select btrim(tok)
    from unnest(string_to_array(stripped, ',')) tok
    where btrim(tok) <> '';
end;
$$;

create table public.eo_dive_addons (
  eo_dive_id text not null references public."EO_dives"(_id)     on delete cascade,
  addon_id   text not null references public."Other_Addons"(_id) on delete cascade,
  primary key (eo_dive_id, addon_id)
);

create table public.eo_course_addons (
  eo_course_id text not null references public."EO_courses"(_id)   on delete cascade,
  addon_id     text not null references public."Other_Addons"(_id) on delete cascade,
  primary key (eo_course_id, addon_id)
);

create index eo_dive_addons_addon_idx   on public.eo_dive_addons   (addon_id);
create index eo_course_addons_addon_idx on public.eo_course_addons (addon_id);

-- One-time backfill. Orphan IDs (referencing addons that don't exist) are
-- filtered out; the FK would reject them anyway.
insert into public.eo_dive_addons (eo_dive_id, addon_id)
select d._id, elem
from public."EO_dives" d
cross join lateral public.parse_addon_ids(d.other_addons) as elem
where exists (select 1 from public."Other_Addons" a where a._id = elem)
on conflict do nothing;

insert into public.eo_course_addons (eo_course_id, addon_id)
select c._id, elem
from public."EO_courses" c
cross join lateral public.parse_addon_ids(c.other_addons) as elem
where exists (select 1 from public."Other_Addons" a where a._id = elem)
on conflict do nothing;

-- Sync triggers: reconcile junction rows when Bubble (or anyone) updates
-- `other_addons`. DELETE-then-reinsert keeps the logic trivially correct.
-- Orphaned IDs are skipped, same as backfill.

create or replace function public.sync_eo_dive_addons() returns trigger
  language plpgsql as $$
begin
  delete from public.eo_dive_addons where eo_dive_id = new._id;
  insert into public.eo_dive_addons (eo_dive_id, addon_id)
  select new._id, elem
  from public.parse_addon_ids(new.other_addons) as elem
  where exists (select 1 from public."Other_Addons" a where a._id = elem)
  on conflict do nothing;
  return new;
end;
$$;

create trigger sync_eo_dive_addons_trg
  after insert or update of other_addons on public."EO_dives"
  for each row execute function public.sync_eo_dive_addons();

create or replace function public.sync_eo_course_addons() returns trigger
  language plpgsql as $$
begin
  delete from public.eo_course_addons where eo_course_id = new._id;
  insert into public.eo_course_addons (eo_course_id, addon_id)
  select new._id, elem
  from public.parse_addon_ids(new.other_addons) as elem
  where exists (select 1 from public."Other_Addons" a where a._id = elem)
  on conflict do nothing;
  return new;
end;
$$;

create trigger sync_eo_course_addons_trg
  after insert or update of other_addons on public."EO_courses"
  for each row execute function public.sync_eo_course_addons();

commit;
