-- Wildlife in the almanac, filed against a taxon instead of typed into a box.
--
-- `almanac_records.wildlife` was a `text[]` fed by one comma-separated input.
-- Nothing joined the strings up, so the same animal arrived as "turtle",
-- "Turtle", "green turtle", "sea turtle", "ウミガメ" and "Chelonia mydas", and
-- every tally the almanac takes counted those as six different sightings. The
-- more divers who file, and the more languages they file in, the further the
-- counts drift from what was actually in the water — which is the one thing
-- this data is collected to measure.
--
-- The fix is to give the animal an identity of its own and make every name a
-- label hung on it:
--
--   taxa         — one row per organism, identified by SCIENTIFIC NAME. This
--                  is the root key. It is the only name that is unique
--                  worldwide, stable across languages, and defined by somebody
--                  other than this project.
--   taxon_names  — the vernacular names, any number per taxon, each tagged
--                  with the language it belongs to. "Green turtle", "アオウミガメ"
--                  and "綠蠵龜" are three rows pointing at one taxon.
--   almanac_sightings — what a record says was seen: a row per taxon per
--                  record, replacing the text array.
--
-- RANK, not species-only. A diver who is sure it was a turtle but not which
-- one is making a real observation, and forcing a binomial would make them
-- either guess or say nothing. So a taxon is filed at the finest rank the
-- observer can honestly reach — phylum through species — and the rank is
-- recorded so a later analysis knows the resolution of what it is counting.
-- The ladder carries subclass and superorder as well as the seven principal
-- ranks, because the two nodes a diver reaches for most often are exactly
-- there: "a shark" is the superorder Selachimorpha and "a ray" is Batoidea,
-- and a ladder without them would force those sightings up to a rung that
-- covers both. `parent_id` chains them, so sightings filed at
-- species roll up to their genus and family.
--
-- SYNONYMS collapse rather than compete. A scientific name that turns out to
-- be another name for something already in the catalog (Manta alfredi, now
-- Mobula alfredi) is kept — divers and old records still use it — with
-- `accepted_id` pointing at the taxon that owns the sightings. Filing against
-- a synonym files against the accepted taxon, so the two can never split a
-- tally between them.

-- ── Ranks ──────────────────────────────────────────────────────────
--
-- A function rather than a CHECK-list repeated in three places: the parent
-- rule needs to compare two ranks, and comparing them means the ladder has to
-- be a value the database can order.
create function public.taxon_rank_depth(p_rank text)
returns integer
immutable
language sql
as $$
  select case p_rank
    when 'phylum'     then 1
    when 'class'      then 2
    when 'subclass'   then 3
    when 'superorder' then 4
    when 'order'      then 5
    when 'family'     then 6
    when 'genus'      then 7
    when 'species'    then 8
  end;
$$;


create table public.taxa (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  rank text not null,
  -- The identity. Latin binomial for a species ("Chelonia mydas"), a single
  -- capitalized word for every rank above it ("Cheloniidae", "Testudines").
  -- The shape is checked because a common name typed into this field is the
  -- exact failure this table exists to prevent, and "green turtle" fails both
  -- patterns.
  scientific_name text not null,
  -- The authority, as taxonomy writes it: "(Linnaeus, 1758)". Decoration for
  -- the reader, and the tiebreaker when two different organisms have been
  -- given the same name.
  authority text,
  -- WoRMS AphiaID — the marine world's identifier registry. Optional, but the
  -- one field that makes this catalog joinable to anybody else's data.
  worms_aphia_id integer,

  parent_id uuid references public.taxa (id) on delete restrict,
  accepted_id uuid references public.taxa (id) on delete restrict,

  -- Divers propose; staff rule. A proposal is visible to its author (so the
  -- record they filed it on reads back correctly) and to staff, and to nobody
  -- else until it is approved.
  status text not null default 'approved',
  proposed_by uuid references auth.users (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  staff_notes text,

  constraint taxa_rank_check check (rank in (
    'phylum', 'class', 'subclass', 'superorder', 'order', 'family', 'genus', 'species'
  )),
  constraint taxa_status_check check (status in ('pending', 'approved', 'rejected')),
  constraint taxa_scientific_name_shape_check check (
    case rank
      when 'species' then scientific_name ~ '^[A-Z][a-z]+ [a-z]+(-[a-z]+)?$'
      else scientific_name ~ '^[A-Z][a-z]+$'
    end
  ),
  constraint taxa_accepted_not_self_check check (accepted_id is distinct from id),
  constraint taxa_parent_not_self_check check (parent_id is distinct from id),
  -- A synonym is a name this catalog does not file sightings under, which is
  -- what `rejected` means here. Keeping the two in step stops a taxon being
  -- offered in the picker and redirected somewhere else at the same time.
  constraint taxa_accepted_is_rejected_check check (
    accepted_id is null or status = 'rejected'
  )
);

create unique index taxa_scientific_name_key on public.taxa (lower(scientific_name));
create unique index taxa_worms_aphia_id_key on public.taxa (worms_aphia_id)
  where worms_aphia_id is not null;
create index taxa_parent_idx on public.taxa (parent_id);
create index taxa_status_idx on public.taxa (status);

comment on table public.taxa is
  'The organisms the almanac can record, keyed by scientific name. Vernacular names live in taxon_names.';


create function public.touch_taxon_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_taxa_touch_updated_at
  before update on public.taxa
  for each row execute function public.touch_taxon_updated_at();


-- Two rules a CHECK cannot state, because both read another row.
--
-- 1. A parent has to sit ABOVE its child on the ladder, and where a species
--    hangs off a genus the genus has to be the one its own name starts with.
--    Chelonia mydas under Eretmochelys is not a deeper classification, it is a
--    contradiction, and left standing it would make every roll-up wrong.
-- 2. Synonyms do not chain. `accepted_id` must land on a taxon that is itself
--    accepted, so resolving a name is one hop and never a walk that can loop.
create function public.check_taxon_lineage()
returns trigger
language plpgsql
as $$
declare
  v_parent_rank text;
  v_parent_name text;
  v_target_status text;
  v_target_accepted uuid;
begin
  if new.parent_id is not null then
    select rank, scientific_name into v_parent_rank, v_parent_name
      from public.taxa where id = new.parent_id;

    if public.taxon_rank_depth(v_parent_rank) >= public.taxon_rank_depth(new.rank) then
      raise exception 'taxon_parent_rank_not_above' using errcode = '23514';
    end if;

    if new.rank = 'species' and v_parent_rank = 'genus'
       and lower(v_parent_name) <> lower(split_part(new.scientific_name, ' ', 1)) then
      raise exception 'taxon_species_genus_mismatch' using errcode = '23514';
    end if;
  end if;

  if new.accepted_id is not null then
    select status, accepted_id into v_target_status, v_target_accepted
      from public.taxa where id = new.accepted_id;

    if v_target_status <> 'approved' or v_target_accepted is not null then
      raise exception 'taxon_accepted_must_be_accepted' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_taxa_check_lineage
  before insert or update on public.taxa
  for each row execute function public.check_taxon_lineage();


-- ── Names ──────────────────────────────────────────────────────────
--
-- One row per name per language. `lang` is a BCP-47 tag rather than a fixed
-- list, so a fork in a language this app does not ship a catalog for still
-- names its wildlife without a migration.
--
-- The unique index on (lang, lower(name)) is the load-bearing one, and it is
-- deliberately across the whole table: within one language a common name
-- points at exactly one taxon. Two taxa both called "barracuda" in English is
-- the ambiguity the free-text column had, moved one table over — the shop has
-- to say which one, or qualify both.
create table public.taxon_names (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  taxon_id   uuid not null references public.taxa (id) on delete cascade,
  lang       text not null,
  name       text not null,
  -- The name to print for that language when a taxon has several. Without one,
  -- a taxon carrying both "green turtle" and "green sea turtle" would render
  -- by whichever row came back first.
  is_primary boolean not null default false,

  constraint taxon_names_lang_check check (lang ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8})*$'),
  constraint taxon_names_name_not_blank_check check (btrim(name) <> '')
);

create unique index taxon_names_unique_per_lang on public.taxon_names (lang, lower(name));
create unique index taxon_names_one_primary_per_lang on public.taxon_names (taxon_id, lang)
  where is_primary;
create index taxon_names_taxon_idx on public.taxon_names (taxon_id);

comment on table public.taxon_names is
  'Vernacular names for a taxon, one row per language. A common name maps to exactly one taxon within its language.';


-- ── Sightings ──────────────────────────────────────────────────────
--
-- `raw_label` is the escape hatch, and it is for history rather than for
-- writing: the free text already recorded before this migration lands somewhere
-- staff can map it from, instead of being deleted. Nothing the app writes today
-- fills it — a diver who cannot find their animal proposes a taxon, which is a
-- name somebody can check, rather than adding another loose string.
create table public.almanac_sightings (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  record_id  uuid not null references public.almanac_records (id) on delete cascade,
  taxon_id   uuid references public.taxa (id) on delete restrict,
  raw_label  text,

  constraint almanac_sightings_one_of_check check (
    (taxon_id is null) <> (raw_label is null)
  ),
  constraint almanac_sightings_raw_label_not_blank_check check (
    raw_label is null or btrim(raw_label) <> ''
  )
);

-- Twice in one record is once. The array could hold "turtle, turtle"; the
-- table cannot hold the same taxon twice, so a double-tap stops inflating a
-- day's count.
create unique index almanac_sightings_unique_taxon
  on public.almanac_sightings (record_id, taxon_id) where taxon_id is not null;
create unique index almanac_sightings_unique_label
  on public.almanac_sightings (record_id, lower(raw_label)) where raw_label is not null;
create index almanac_sightings_taxon_idx on public.almanac_sightings (taxon_id);

comment on table public.almanac_sightings is
  'What an almanac record says was seen: one row per taxon. raw_label holds pre-taxonomy free text awaiting a staff mapping.';


-- ── Reads for clients, writes through functions ────────────────────
--
-- The same shape the rest of the almanac uses: `authenticated` holds SELECT and
-- nothing else, so the proposal state machine cannot be driven from a browser.
alter table public.taxa enable row level security;
alter table public.taxon_names enable row level security;
alter table public.almanac_sightings enable row level security;

grant select on public.taxa to authenticated;
grant select on public.taxon_names to authenticated;
grant select on public.almanac_sightings to authenticated;

-- Spelled out rather than inherited. A table created after the project's
-- default privileges were set gets none of them on the incremental path a
-- production push takes, and the failure is invisible until the backup export
-- or an edge function reads the table as service_role and is refused.
grant all on public.taxa to service_role;
grant all on public.taxon_names to service_role;
grant all on public.almanac_sightings to service_role;

-- Approved taxa are the catalog. A pending proposal is visible to the diver
-- who made it — their own record has to read back with the animal they named
-- on it — and to staff, who have to rule on it. Synonyms stay readable by
-- everyone: an old record pointing at one still has to render.
create policy "Divers read the approved catalog and their own proposals"
  on public.taxa for select
  to authenticated
  using (
    status <> 'pending'
    or proposed_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role in ('staff', 'admin')
    )
  );

create policy "Names are readable with their taxon"
  on public.taxon_names for select
  to authenticated
  using (exists (
    select 1 from public.taxa t
    where t.id = taxon_names.taxon_id
      and (
        t.status <> 'pending'
        or t.proposed_by = auth.uid()
        or exists (
          select 1 from public.profiles
          where profiles.id = auth.uid() and profiles.role in ('staff', 'admin')
        )
      )
  ));

-- A sighting is readable exactly when the record carrying it is: the diver's
-- own, or approved, or anything at all for staff. Stated here rather than left
-- to the RPCs because the "Your entries" tab reads its own rows straight off
-- the table with the sightings embedded.
create policy "Sightings follow their record"
  on public.almanac_sightings for select
  to authenticated
  using (exists (
    select 1 from public.almanac_records r
    where r.id = almanac_sightings.record_id
      and (
        r.diver_id = auth.uid()
        or r.status = 'approved'
        or exists (
          select 1 from public.profiles
          where profiles.id = auth.uid() and profiles.role in ('staff', 'admin')
        )
      )
  ));


-- ── Resolving a name ───────────────────────────────────────────────
--
-- One hop, never a walk: the lineage trigger guarantees an `accepted_id` lands
-- on a taxon that has none of its own, so this is the whole of synonym
-- resolution and it cannot loop.
create function public.taxon_accepted(p_taxon_id uuid)
returns uuid
stable
security definer
set search_path to 'public'
language sql
as $$
  select coalesce(t.accepted_id, t.id) from public.taxa t where t.id = p_taxon_id;
$$;

revoke all on function public.taxon_accepted(uuid) from public, anon;
grant execute on function public.taxon_accepted(uuid) to authenticated, service_role;


-- ── Proposing a taxon ──────────────────────────────────────────────
--
-- The diver's way out of "it isn't in the list". They give a scientific name —
-- the picker asks for it, and refuses the shape a common name has — and
-- optionally what they call it, and get back an id they can file the sighting
-- against straight away. The proposal is pending: nobody else's picker offers
-- it and no crowd tally counts it until staff rule.
--
-- GET-OR-PROPOSE, not always-insert. A name already in the catalog comes back
-- as itself (resolved through any synonym), and a name somebody else has
-- already proposed comes back as that proposal rather than as a second one.
-- Duplicate proposals of the same animal are the same disease as duplicate
-- free text, arriving one table later, and the unique index would refuse them
-- anyway — as an error the diver could do nothing about.
create function public.propose_taxon(
  p_rank text,
  p_scientific_name text,
  p_parent_id uuid default null,
  p_common_name text default null,
  p_lang text default null
)
returns uuid
security definer
set search_path to 'public'
language plpgsql
as $$
declare
  v_name text := btrim(p_scientific_name);
  v_taxon_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select coalesce(accepted_id, id) into v_taxon_id
    from public.taxa where lower(scientific_name) = lower(v_name);

  if v_taxon_id is null then
    insert into public.taxa (rank, scientific_name, parent_id, status, proposed_by)
      values (p_rank, v_name, p_parent_id, 'pending', auth.uid())
      returning id into v_taxon_id;
  end if;

  -- The common name is a courtesy, not the proposal. If that name already
  -- belongs to another taxon in that language the catalog's existing mapping
  -- stands: one name, one animal, and a diver's spelling of it does not get to
  -- overturn a curated entry. The taxon is still created and still usable.
  if p_common_name is not null and btrim(p_common_name) <> '' and p_lang is not null then
    insert into public.taxon_names (taxon_id, lang, name)
      values (v_taxon_id, p_lang, btrim(p_common_name))
      on conflict do nothing;
  end if;

  return v_taxon_id;
end;
$$;

revoke all on function public.propose_taxon(text, text, uuid, text, text) from public, anon;
grant execute on function public.propose_taxon(text, text, uuid, text, text) to authenticated, service_role;


-- ── Curating the catalog (staff) ───────────────────────────────────

create function public.save_taxon(
  p_id uuid,
  p_rank text,
  p_scientific_name text,
  p_authority text default null,
  p_worms_aphia_id integer default null,
  p_parent_id uuid default null
)
returns uuid
security definer
set search_path to 'public'
language plpgsql
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role in ('staff', 'admin')
  ) then
    raise exception 'staff or admin role required' using errcode = '42501';
  end if;

  if p_id is null then
    insert into public.taxa (
      rank, scientific_name, authority, worms_aphia_id, parent_id, status, reviewed_by, reviewed_at
    ) values (
      p_rank, btrim(p_scientific_name), nullif(btrim(coalesce(p_authority, '')), ''),
      p_worms_aphia_id, p_parent_id, 'approved', auth.uid(), now()
    ) returning id into v_id;
  else
    update public.taxa
      set rank = p_rank,
          scientific_name = btrim(p_scientific_name),
          authority = nullif(btrim(coalesce(p_authority, '')), ''),
          worms_aphia_id = p_worms_aphia_id,
          parent_id = p_parent_id
      where id = p_id
      returning id into v_id;

    if v_id is null then
      raise exception 'taxon_not_found' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_taxon(uuid, text, text, text, integer, uuid) from public, anon;
grant execute on function public.save_taxon(uuid, text, text, text, integer, uuid) to authenticated, service_role;


-- Rule on a proposal, and merge duplicates.
--
-- `p_accepted_id` is what makes this more than an approve/reject switch: a
-- proposal that turns out to be a name the catalog already carries is rejected
-- AND pointed at the taxon that owns it, and every sighting already filed
-- against it moves across. That is the merge, and it is the one operation that
-- undoes a duplicate after the fact instead of just refusing the next one.
create function public.moderate_taxon(
  p_taxon_id uuid,
  p_status text,
  p_accepted_id uuid default null,
  p_staff_notes text default null
)
returns void
security definer
set search_path to 'public'
language plpgsql
as $$
declare
  v_target uuid;
begin
  if not exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role in ('staff', 'admin')
  ) then
    raise exception 'staff or admin role required' using errcode = '42501';
  end if;

  if p_status not in ('approved', 'rejected') then
    raise exception 'taxon_status_must_be_approved_or_rejected' using errcode = '23514';
  end if;

  if p_accepted_id is not null and p_status <> 'rejected' then
    raise exception 'taxon_merge_must_reject' using errcode = '23514';
  end if;

  if p_accepted_id is not null then
    v_target := public.taxon_accepted(p_accepted_id);

    -- Move the sightings first, and drop the ones that would collide: a record
    -- that named both the synonym and the accepted taxon said one thing twice,
    -- and after the merge it says it once.
    delete from public.almanac_sightings s
      where s.taxon_id = p_taxon_id
        and exists (
          select 1 from public.almanac_sightings other
          where other.record_id = s.record_id and other.taxon_id = v_target
        );

    update public.almanac_sightings
      set taxon_id = v_target
      where taxon_id = p_taxon_id;

    update public.taxa set parent_id = v_target where parent_id = p_taxon_id;
  end if;

  update public.taxa
    set status = p_status,
        accepted_id = case when p_accepted_id is null then null else v_target end,
        staff_notes = p_staff_notes,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = p_taxon_id;

  if not found then
    raise exception 'taxon_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.moderate_taxon(uuid, text, uuid, text) from public, anon;
grant execute on function public.moderate_taxon(uuid, text, uuid, text) to authenticated, service_role;


-- Deleting is for a taxon nothing stands on. Anything with sightings is
-- merged or rejected instead — a delete would take real observations with it,
-- and the FK is RESTRICT so the attempt would fail late and opaquely.
create function public.delete_taxon(p_taxon_id uuid)
returns void
security definer
set search_path to 'public'
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role in ('staff', 'admin')
  ) then
    raise exception 'staff or admin role required' using errcode = '42501';
  end if;

  if exists (select 1 from public.almanac_sightings where taxon_id = p_taxon_id) then
    raise exception 'taxon_has_sightings' using errcode = '23503';
  end if;

  if exists (select 1 from public.taxa where parent_id = p_taxon_id) then
    raise exception 'taxon_has_children' using errcode = '23503';
  end if;

  delete from public.taxa where id = p_taxon_id;

  if not found then
    raise exception 'taxon_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.delete_taxon(uuid) from public, anon;
grant execute on function public.delete_taxon(uuid) to authenticated, service_role;


create function public.set_taxon_name(
  p_taxon_id uuid,
  p_lang text,
  p_name text,
  p_is_primary boolean default false,
  p_name_id uuid default null
)
returns uuid
security definer
set search_path to 'public'
language plpgsql
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role in ('staff', 'admin')
  ) then
    raise exception 'staff or admin role required' using errcode = '42501';
  end if;

  -- One primary per language, and the index enforcing it is unique rather than
  -- partial-on-update-order, so the outgoing primary is stood down before the
  -- incoming one is raised.
  if p_is_primary then
    update public.taxon_names
      set is_primary = false
      where taxon_id = p_taxon_id and lang = p_lang and is_primary
        and (p_name_id is null or id <> p_name_id);
  end if;

  if p_name_id is null then
    insert into public.taxon_names (taxon_id, lang, name, is_primary)
      values (p_taxon_id, p_lang, btrim(p_name), p_is_primary)
      returning id into v_id;
  else
    update public.taxon_names
      set lang = p_lang, name = btrim(p_name), is_primary = p_is_primary
      where id = p_name_id
      returning id into v_id;

    if v_id is null then
      raise exception 'taxon_name_not_found' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.set_taxon_name(uuid, text, text, boolean, uuid) from public, anon;
grant execute on function public.set_taxon_name(uuid, text, text, boolean, uuid) to authenticated, service_role;


create function public.delete_taxon_name(p_name_id uuid)
returns void
security definer
set search_path to 'public'
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role in ('staff', 'admin')
  ) then
    raise exception 'staff or admin role required' using errcode = '42501';
  end if;

  delete from public.taxon_names where id = p_name_id;

  if not found then
    raise exception 'taxon_name_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.delete_taxon_name(uuid) from public, anon;
grant execute on function public.delete_taxon_name(uuid) to authenticated, service_role;


-- ── The free text that is left ─────────────────────────────────────
--
-- What the old column carried and the backfill could not match, grouped by the
-- string itself: staff map "clownfish" once and every sighting that says it
-- moves. A queue rather than a report, so the loose text is finite and
-- shrinking instead of permanent.
create function public.almanac_unmatched_wildlife()
returns table (label text, sightings bigint, records bigint)
security definer
set search_path to 'public'
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role in ('staff', 'admin')
  ) then
    raise exception 'staff or admin role required' using errcode = '42501';
  end if;

  return query
  select min(s.raw_label)::text as label,
         count(*)::bigint as sightings,
         count(distinct s.record_id)::bigint as records
  from public.almanac_sightings s
  where s.raw_label is not null
  group by lower(s.raw_label)
  order by count(*) desc, min(s.raw_label);
end;
$$;

revoke all on function public.almanac_unmatched_wildlife() from public, anon;
grant execute on function public.almanac_unmatched_wildlife() to authenticated, service_role;


-- Map one loose label onto a taxon. Returns how many sightings moved, so the
-- admin page can say what the click did rather than just redrawing.
create function public.map_unmatched_wildlife(p_label text, p_taxon_id uuid)
returns integer
security definer
set search_path to 'public'
language plpgsql
as $$
declare
  v_target uuid;
  v_moved integer;
begin
  if not exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role in ('staff', 'admin')
  ) then
    raise exception 'staff or admin role required' using errcode = '42501';
  end if;

  v_target := public.taxon_accepted(p_taxon_id);
  if v_target is null then
    raise exception 'taxon_not_found' using errcode = 'P0002';
  end if;

  -- A record that already names the taxon and also carries the loose label was
  -- always one sighting. The label goes; the sighting stays.
  delete from public.almanac_sightings s
    where lower(s.raw_label) = lower(btrim(p_label))
      and exists (
        select 1 from public.almanac_sightings other
        where other.record_id = s.record_id and other.taxon_id = v_target
      );

  update public.almanac_sightings
    set taxon_id = v_target, raw_label = null
    where lower(raw_label) = lower(btrim(p_label));

  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

revoke all on function public.map_unmatched_wildlife(text, uuid) from public, anon;
grant execute on function public.map_unmatched_wildlife(text, uuid) to authenticated, service_role;


-- ── The almanac's own RPCs, repointed ──────────────────────────────
--
-- `wildlife text[]` becomes two arrays: the taxa a record filed, and whatever
-- loose text is still waiting to be mapped. Two rather than one blended list
-- because they are different kinds of thing — an id the client resolves against
-- the catalog it already holds, and a string nobody has vouched for — and a
-- surface that could not tell them apart would print an unverified label beside
-- a curated one as if they carried the same weight.
--
-- Ids rather than resolved names: the page loads the catalog once for the
-- picker and every reading surface renders from that one map, so a payload
-- carrying names would be the same strings repeated on every row, in a language
-- chosen by the database instead of by the app's config.

drop function if exists public.almanac_records_in_range(date, date);

create function public.almanac_records_in_range(p_from date, p_to date)
returns table (
  id uuid,
  site_id uuid,
  site_name text,
  site_kind text,
  created_at timestamptz,
  obs_date date,
  air_temp_c numeric(4,1),
  water_temp_c numeric(4,1),
  visibility_m numeric(4,1),
  current_strength text,
  wave_height_m numeric(3,1),
  wave_period_s numeric(3,1),
  weather text,
  wildlife_taxa uuid[],
  wildlife_unmatched text[],
  coral_health text,
  elevation_m numeric(5,0),
  route_condition text,
  summit_visible boolean,
  trash_band text,
  trash_count integer,
  trash_kinds text[],
  diver_display text
)
security definer
set search_path to 'public'
language sql
as $$
  select
    r.id, r.site_id, s.name as site_name, s.kind as site_kind,
    r.created_at, r.obs_date,
    r.air_temp_c, r.water_temp_c, r.visibility_m,
    r.current_strength, r.wave_height_m, r.wave_period_s,
    r.weather,
    coalesce((
      select array_agg(sg.taxon_id order by sg.created_at)
      from public.almanac_sightings sg
      where sg.record_id = r.id and sg.taxon_id is not null
    ), array[]::uuid[]) as wildlife_taxa,
    coalesce((
      select array_agg(sg.raw_label order by sg.raw_label)
      from public.almanac_sightings sg
      where sg.record_id = r.id and sg.raw_label is not null
    ), array[]::text[]) as wildlife_unmatched,
    r.coral_health,
    r.elevation_m, r.route_condition, r.summit_visible,
    r.trash_band, r.trash_count, r.trash_kinds,
    coalesce(p.nickname, p.name) as diver_display
  from public.almanac_records r
  join public.profiles p on p.id = r.diver_id
  join public.dive_sites s on s.id = r.site_id
  where r.status = 'approved'
    and r.obs_date between p_from and p_to
  order by r.obs_date desc, s.name, r.created_at desc;
$$;

revoke all on function public.almanac_records_in_range(date, date) from public, anon;
grant execute on function public.almanac_records_in_range(date, date) to authenticated, service_role;


drop function if exists public.almanac_pending_records();

create function public.almanac_pending_records()
returns table (
  id uuid,
  site_id uuid,
  site_name text,
  site_kind text,
  obs_date date,
  created_at timestamptz,
  air_temp_c numeric(4,1),
  water_temp_c numeric(4,1),
  visibility_m numeric(4,1),
  current_strength text,
  wave_height_m numeric(3,1),
  wave_period_s numeric(3,1),
  weather text,
  wildlife_taxa uuid[],
  wildlife_unmatched text[],
  coral_health text,
  elevation_m numeric(5,0),
  route_condition text,
  summit_visible boolean,
  trash_band text,
  trash_count integer,
  trash_kinds text[],
  diver_display text,
  unreviewed_taxa uuid[]
)
security definer
set search_path to 'public'
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('staff', 'admin')
  ) then
    raise exception 'staff or admin role required' using errcode = '42501';
  end if;

  return query
  select
    r.id, r.site_id, s.name as site_name, s.kind as site_kind,
    r.obs_date, r.created_at,
    r.air_temp_c, r.water_temp_c, r.visibility_m,
    r.current_strength, r.wave_height_m, r.wave_period_s,
    r.weather,
    coalesce((
      select array_agg(sg.taxon_id order by sg.created_at)
      from public.almanac_sightings sg
      where sg.record_id = r.id and sg.taxon_id is not null
    ), array[]::uuid[]) as wildlife_taxa,
    coalesce((
      select array_agg(sg.raw_label order by sg.raw_label)
      from public.almanac_sightings sg
      where sg.record_id = r.id and sg.raw_label is not null
    ), array[]::text[]) as wildlife_unmatched,
    r.coral_health,
    r.elevation_m, r.route_condition, r.summit_visible,
    r.trash_band, r.trash_count, r.trash_kinds,
    coalesce(p.nickname, p.name) as diver_display,
    -- Which of this record's animals are themselves waiting on a ruling. The
    -- record cannot be approved while any are, so the queue says so up front
    -- rather than letting staff press Approve and read an error.
    coalesce((
      select array_agg(t.id order by t.scientific_name)
      from public.almanac_sightings sg
      join public.taxa t on t.id = sg.taxon_id
      where sg.record_id = r.id and t.status = 'pending'
    ), array[]::uuid[]) as unreviewed_taxa
  from public.almanac_records r
  join public.profiles p on p.id = r.diver_id
  join public.dive_sites s on s.id = r.site_id
  where r.status = 'pending'
  order by r.created_at asc;
end;
$$;

revoke all on function public.almanac_pending_records() from public, anon;
grant execute on function public.almanac_pending_records() to authenticated, service_role;


-- Wildlife arrives as taxon ids now. The sightings are rewritten wholesale on
-- every save, exactly as the column was: a revision states what the diver saw,
-- not a delta against what they said last time, and merging would leave an
-- animal they removed standing on the record.
--
-- Loose labels survive a revision untouched. They are not on the form, so a
-- save cannot mean "the diver withdrew them" — it means the form had nothing
-- to say about them.
drop function if exists public.submit_almanac_record(
  uuid, date, numeric, numeric, numeric, text, numeric, numeric,
  text, text[], text, numeric, text, boolean, text, text[]
);

create function public.submit_almanac_record(
  p_site_id uuid,
  p_obs_date date,
  p_air_temp_c numeric default null,
  p_water_temp_c numeric default null,
  p_visibility_m numeric default null,
  p_current_strength text default null,
  p_wave_height_m numeric default null,
  p_wave_period_s numeric default null,
  p_weather text default null,
  p_taxon_ids uuid[] default null,
  p_coral_health text default null,
  p_elevation_m numeric default null,
  p_route_condition text default null,
  p_summit_visible boolean default null,
  p_trash_band text default null,
  p_trash_kinds text[] default null
)
returns uuid
security definer
set search_path to 'public'
language plpgsql
as $$
declare
  v_record_id uuid;
  v_existing_status text;
  v_kinds text[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Compared against tomorrow rather than today: the client sends a date in the
  -- shop's timezone and the database clock is UTC, so between midnight and
  -- 08:00 in Taipei a same-day record looks like a future one. A day of slack
  -- absorbs every offset on earth and still refuses a date nobody could have
  -- observed.
  if p_obs_date > current_date + 1 then
    raise exception 'almanac_obs_date_in_future' using errcode = '23514';
  end if;

  -- Every id has to name something this diver may file against: the approved
  -- catalog, or a proposal of their own still waiting on staff. Checked before
  -- anything is written, and loudly — an id that quietly dropped out would be
  -- an animal the diver watched themselves enter and never saw again.
  if exists (
    select 1 from unnest(coalesce(p_taxon_ids, array[]::uuid[])) as u(id)
    where not exists (
      select 1
      from public.taxa t
      join public.taxa r on r.id = coalesce(t.accepted_id, t.id)
      where t.id = u.id
        and (r.status = 'approved' or (r.status = 'pending' and r.proposed_by = auth.uid()))
    )
  ) then
    raise exception 'almanac_taxon_not_selectable' using errcode = '23503';
  end if;

  -- A band of "none" settles the kinds question on its own, so a stale
  -- selection left behind by a diver correcting their answer downwards is
  -- dropped rather than rejected. Anything else the check constraints judge.
  v_kinds := coalesce(p_trash_kinds, array[]::text[]);
  if p_trash_band = 'none' then
    v_kinds := array[]::text[];
  end if;

  select id, status into v_record_id, v_existing_status
    from public.almanac_records
    where site_id = p_site_id
      and obs_date = p_obs_date
      and diver_id = auth.uid();

  if v_record_id is not null and v_existing_status <> 'pending' then
    raise exception 'almanac_record_already_reviewed' using errcode = '23505';
  end if;

  if v_record_id is null then
    insert into public.almanac_records (
      diver_id, site_id, obs_date,
      air_temp_c, water_temp_c, visibility_m,
      current_strength, wave_height_m, wave_period_s,
      weather, coral_health,
      elevation_m, route_condition, summit_visible,
      trash_band, trash_kinds
    ) values (
      auth.uid(), p_site_id, p_obs_date,
      p_air_temp_c, p_water_temp_c, p_visibility_m,
      p_current_strength, p_wave_height_m, p_wave_period_s,
      p_weather, p_coral_health,
      p_elevation_m, p_route_condition, p_summit_visible,
      p_trash_band, v_kinds
    ) returning id into v_record_id;
  else
    update public.almanac_records
      set air_temp_c = p_air_temp_c,
          water_temp_c = p_water_temp_c,
          visibility_m = p_visibility_m,
          current_strength = p_current_strength,
          wave_height_m = p_wave_height_m,
          wave_period_s = p_wave_period_s,
          weather = p_weather,
          coral_health = p_coral_health,
          elevation_m = p_elevation_m,
          route_condition = p_route_condition,
          summit_visible = p_summit_visible,
          trash_band = p_trash_band,
          trash_kinds = v_kinds
      where id = v_record_id;
  end if;

  delete from public.almanac_sightings
    where record_id = v_record_id and taxon_id is not null;

  insert into public.almanac_sightings (record_id, taxon_id)
  select distinct v_record_id, coalesce(t.accepted_id, t.id)
    from unnest(coalesce(p_taxon_ids, array[]::uuid[])) as u(id)
    join public.taxa t on t.id = u.id;

  return v_record_id;
end;
$$;

revoke all on function public.submit_almanac_record(
  uuid, date, numeric, numeric, numeric, text, numeric, numeric,
  text, uuid[], text, numeric, text, boolean, text, text[]
) from public, anon;
grant execute on function public.submit_almanac_record(
  uuid, date, numeric, numeric, numeric, text, numeric, numeric,
  text, uuid[], text, numeric, text, boolean, text, text[]
) to authenticated, service_role;


-- Approving a record approves what it says, and a record naming an animal
-- nobody has vouched for says something the catalog has not agreed to. Staff
-- rule on the taxon first — approve it, or merge it into the entry it
-- duplicates — and the record follows. Rejecting is never blocked: a record
-- being thrown out does not need its wildlife adjudicated first.
create or replace function public.moderate_almanac_record(
  p_record_id uuid,
  p_status text,
  p_staff_notes text default null
)
returns void
security definer
set search_path to 'public'
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('staff', 'admin')
  ) then
    raise exception 'staff or admin role required' using errcode = '42501';
  end if;

  if p_status not in ('approved', 'rejected') then
    raise exception 'almanac_status_must_be_approved_or_rejected' using errcode = '23514';
  end if;

  if p_status = 'approved' and exists (
    select 1
    from public.almanac_sightings s
    join public.taxa t on t.id = s.taxon_id
    where s.record_id = p_record_id and t.status = 'pending'
  ) then
    raise exception 'almanac_record_has_unreviewed_taxa' using errcode = '23514';
  end if;

  update public.almanac_records
    set status = p_status,
        staff_notes = p_staff_notes,
        approved_by = auth.uid(),
        approved_at = now()
    where id = p_record_id;

  if not found then
    raise exception 'almanac_record_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.moderate_almanac_record(uuid, text, text) from public, anon;
grant execute on function public.moderate_almanac_record(uuid, text, text) to authenticated, service_role;
