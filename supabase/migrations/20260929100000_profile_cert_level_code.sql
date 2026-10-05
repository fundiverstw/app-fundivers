-- A diver's certification becomes a pointer into `cert_levels`, not a string.
--
-- `profiles.cert_level` has always been free text. The register forms took
-- whatever was typed ("OW", "AOW & nitrox", "Advance Adventure Diver"), and
-- every reader that needed to know what rung a diver holds had to re-derive it
-- by fuzzy matching — the dashboard (src/lib/cert-level.ts), the 20260910
-- normalization pass, and the event prerequisite gate. Each match is an opinion,
-- and the prerequisite gate's bugs all came from those opinions.
--
-- `cert_levels` already holds the enumeration: every agency's ladder, its rank,
-- and the PADI rung it corresponds to. So the diver now picks a row, and
-- `profiles.cert_level_code` stores that row's `code` — a foreign key, so only
-- a listed level can be stored, and a readable one ('ssi_advanced_open_water')
-- so SQL, exports and logs say what it is without a join. The code is the
-- enum value; the table is where each value's rank and equivalence live.
--
-- What happens to the text columns:
--
--   * `cert_agency` / `cert_level` stay, but as a copy of the picked row's
--     `organization` / `name`, kept in step by a trigger. Every screen, export
--     and edge function that prints "PADI AOW" keeps working unchanged, and
--     nothing that prints can drift from the row.
--   * Where the backfill below cannot place a legacy value ("PE40", an agency
--     the ladder does not hold), `cert_level_code` stays null and the text is
--     left exactly as it was. That row is the admin's (or the diver's) to fix;
--     the profile page and register form both ask the diver to pick again.
--
-- Nothing is guessed. A null `cert_level_code` means "we do not know", never
-- "uncertified" — that remains `profiles.uncertified`.

-- ── The agencies the shop supports ─────────────────────────────────────────
-- TDI (technical) is not supported yet, so a diver cannot pick it and the
-- backfill cannot place anyone on it. Adding it back later is an insert. CMAS
-- stays: its rows already carry a `padi_equivalent_id` (1-Star = OW, 2-Star =
-- Rescue, 3-Star = DM), and FunDivers is a PADI shop, so PADI's reciprocity is
-- the guideline. Nitrox is not a rung: it is the `nitrox_certified` checkbox.
-- Event prerequisites only ever point at PADI rows, and the shop's standards
-- agency is only checked when saved, so clear it if it named TDI.
--
-- `events.prereq_cert_id` is ON DELETE SET NULL, so deleting a rung an event
-- requires would quietly lift the requirement. Move any such event onto the
-- PADI rung the TDI row corresponds to, and stop if one has none.
update public.events e
   set prereq_cert_id = c.padi_equivalent_id
  from public.cert_levels c
 where e.prereq_cert_id = c.id
   and c.organization = 'TDI'
   and c.padi_equivalent_id is not null;
do $$
begin
  if exists (
    select 1 from public.events e
      join public.cert_levels c on c.id = e.prereq_cert_id
     where c.organization = 'TDI'
  ) then
    raise exception 'an event requires a TDI level with no PADI equivalent; re-point it before this migration';
  end if;
end;
$$;
delete from public.cert_levels where organization = 'TDI';
update public.shop_profile set standards_org = null where standards_org = 'TDI';

-- ── nitrox_required is a dive flag ─────────────────────────────────────────
-- The event form only offers it on a dive and saves false for every other
-- kind, but a row imported, or whose kind was changed outside the form, can
-- still carry it — and the booking gate now hard-blocks on it. Clear it once
-- here and hold it there, so no reader has to filter by kind.
update public.events set nitrox_required = false
 where kind <> 'dive' and nitrox_required;
alter table public.events
  drop constraint if exists events_nitrox_required_dive_only;
alter table public.events
  add constraint events_nitrox_required_dive_only
    check (kind = 'dive' or not coalesce(nitrox_required, false));

-- ── The column ──────────────────────────────────────────────────────────────
-- `on delete restrict`: deleting a rung divers hold would silently decertify
-- them. Re-point them first. `on update cascade` so a code can be corrected
-- without touching every profile by hand.
alter table public.profiles
  add column if not exists cert_level_code text
    references public.cert_levels(code) on update cascade on delete restrict;

create index if not exists profiles_cert_level_code_idx
  on public.profiles (cert_level_code);

-- A diver who holds no certification cannot also hold a rung.
alter table public.profiles
  drop constraint if exists profiles_cert_level_or_uncertified;
alter table public.profiles
  add constraint profiles_cert_level_or_uncertified
    check (not (uncertified and cert_level_code is not null));

-- ── The text copy follows the row ───────────────────────────────────────────
-- Named so it sorts before `profiles_maybe_set_submitted_at_trg`: BEFORE
-- triggers fire in name order, and anything downstream should see the copy
-- already written.
create or replace function public.profiles_mirror_cert_level()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Nothing cert-related changed (a contact edit, a gear size): leave the
  -- copy as it is rather than look the row up again.
  if tg_op = 'UPDATE'
     and new.cert_level_code is not distinct from old.cert_level_code
     and new.cert_agency     is not distinct from old.cert_agency
     and new.cert_level      is not distinct from old.cert_level
     and new.uncertified     is not distinct from old.uncertified then
    return new;
  end if;
  if new.cert_level_code is not null then
    select c.organization, c.name
      into new.cert_agency, new.cert_level
      from public.cert_levels c
     where c.code = new.cert_level_code;
  elsif new.uncertified
     or (tg_op = 'UPDATE' and old.cert_level_code is not null) then
    -- Cleared: either "I hold nothing", or the pick was removed. Leaving the
    -- old text would show a rung the profile no longer claims.
    new.cert_agency := null;
    new.cert_level  := null;
  end if;
  -- Otherwise the code was null and still is: a legacy value the backfill could
  -- not place. Leave its text alone so someone can see what to fix.
  return new;
end;
$$;

drop trigger if exists profiles_cert_level_mirror_trg on public.profiles;
create trigger profiles_cert_level_mirror_trg
  before insert or update on public.profiles
  for each row execute function public.profiles_mirror_cert_level();

-- An admin renaming a rung (or its agency) updates every copy of it, and an
-- admin correcting a code has the FK's ON UPDATE CASCADE rewrite every
-- holder's profile. Neither is a diver completing their profile, so both run
-- with `fundivers.suppress_application_latch` set: without it the latch below
-- would stamp any complete-but-never-stamped profile today, and it would
-- surface as a fresh application. The flag is transaction-local, set before
-- any row changes (the RI cascade fires among the row AFTER triggers) and
-- cleared once the whole statement is done.
create or replace function public.cert_levels_suppress_application_latch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform set_config('fundivers.suppress_application_latch', 'on', true);
  return case when tg_level = 'ROW' then new else null end;
end;
$$;

create or replace function public.cert_levels_release_application_latch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform set_config('fundivers.suppress_application_latch', '', true);
  return null;
end;
$$;

create or replace function public.cert_levels_refresh_profile_copies()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The mirror trigger re-derives the same text from the code; writing it
  -- here is what tells it the copy changed.
  update public.profiles
     set cert_agency = new.organization,
         cert_level  = new.name
   where cert_level_code = new.code;
  return null;
end;
$$;

drop trigger if exists cert_levels_suppress_latch_trg on public.cert_levels;
create trigger cert_levels_suppress_latch_trg
  before update of code, name, organization on public.cert_levels
  for each row execute function public.cert_levels_suppress_application_latch();

drop trigger if exists cert_levels_refresh_profile_copies_trg on public.cert_levels;
create trigger cert_levels_refresh_profile_copies_trg
  after update of name, organization on public.cert_levels
  for each row
  when (old.name is distinct from new.name or old.organization is distinct from new.organization)
  execute function public.cert_levels_refresh_profile_copies();

drop trigger if exists cert_levels_release_latch_trg on public.cert_levels;
create trigger cert_levels_release_latch_trg
  after update of code, name, organization on public.cert_levels
  for each statement execute function public.cert_levels_release_application_latch();

-- ── The application latch reads the pick, not the text ──────────────────────
-- A legacy string the ladder cannot place is not a certification on file.
create or replace function public.maybe_set_application_submitted_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A system pass over many profiles — a rung renamed or recoded under them,
  -- the backfill, the normalize pass — is not a diver submitting anything.
  if current_setting('fundivers.suppress_application_latch', true) = 'on' then
    return new;
  end if;
  if new.application_submitted_at is null
     and new.name           is not null and length(btrim(new.name))       > 0
     and new.date_of_birth   is not null
     and new.cert_level_code is not null
     and new.contact_method  is not null
     and new.contact_id      is not null and length(btrim(new.contact_id)) > 0
  then
    new.application_submitted_at := now();
  end if;
  return new;
end;
$$;

-- ── Matching one legacy value to a row ──────────────────────────────────────
-- Agency and level together, because the level alone is ambiguous: "Rescue
-- Diver" is PADI's and SDI's, "Master Scuba Diver" is SDI's rung 4 and NAUI's
-- rung 3, "Advanced Diver" is BSAC's divemaster-level rung.
--
-- In order, stopping at the first hit:
--
--   1. The agency's own rung by name or code ("SDI" + "Rescue" → SDI Rescue
--      Diver).
--   2. The PADI rung the value names (via padi_equivalent_of, which also knows
--      the shorthand no agency spells out: "owd", "owsi", "cd"), then back to
--      the agency's rung that points at it — but only if exactly one does.
--      "SSI" + "AOW" is SSI Advanced Open Water Diver; "SSI" + "Rescue" could
--      be Stress & Rescue or Master Diver, so it is left alone.
--
-- With no agency given, a name that only one agency uses is taken as that
-- agency's; a name several agencies share goes to PADI's rung if PADI has one,
-- else is left alone.
--
-- A value listing several certifications ("OW/AOW", "AOW & nitrox", "OW,
-- Rescue") that doesn't match whole is matched part by part, and the highest
-- level any part names is taken: the diver holds each one they listed, and
-- the first is usually the lowest, so taking it would block an AOW holder
-- from AOW dives. Parts that name no rung ("nitrox") drop out.
--
-- An agency the ladder does not hold ("PSAI", "123132") matches nothing.
create or replace function public.cert_level_code_of(p_agency text, p_level text)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_org     text;
  v_reading text;
  v_key     text;
  v_code    text;
  v_padi    text;
  v_orgs    text[];
begin
  if coalesce(btrim(p_level), '') = '' then
    return null;
  end if;

  if coalesce(btrim(p_agency), '') <> '' then
    select c.organization into v_org
      from public.cert_levels c
     where regexp_replace(lower(c.organization), '[^a-z0-9]', '', 'g')
         = regexp_replace(lower(p_agency),       '[^a-z0-9]', '', 'g')
     limit 1;
    if v_org is null then
      return null;
    end if;
  end if;

  -- The whole string first; a list of several is split up after this block.
  -- `exit whole` gives up on the whole-string reading and falls through.
  v_reading := btrim(p_level);
  <<whole>>
  begin
    v_key := public.cert_match_key(v_reading);
    exit whole when v_key is null;

    -- 1. By name or code.
    if v_org is not null then
      select c.code into v_code
        from public.cert_levels c
       where c.organization = v_org
         and (public.cert_match_key(c.name) = v_key or public.cert_match_key(c.code) = v_key)
       order by c.rank
       limit 1;
    else
      select array_agg(distinct c.organization) into v_orgs
        from public.cert_levels c
       where public.cert_match_key(c.name) = v_key or public.cert_match_key(c.code) = v_key;

      if v_orgs is not null and ('PADI' = any(v_orgs) or cardinality(v_orgs) = 1) then
        select c.code into v_code
          from public.cert_levels c
         where c.organization = case when 'PADI' = any(v_orgs) then 'PADI' else v_orgs[1] end
           and (public.cert_match_key(c.name) = v_key or public.cert_match_key(c.code) = v_key)
         order by c.rank
         limit 1;
      end if;
    end if;

    if v_code is not null then
      return v_code;
    end if;

    -- Several agencies use this name and none of them is PADI: which one the
    -- diver meant is exactly what we don't know. Don't let step 2 pick PADI.
    exit whole when v_org is null and v_orgs is not null;

    -- 2. Via the PADI rung. Not for a list: padi_equivalent_of falls back to
    -- its first part, which is the guess the part-by-part match below avoids.
    v_padi := case when v_reading ~ '[&/,+]' then null else public.padi_equivalent_of(v_reading) end;
    if v_padi is not null then
      if v_org is null or v_org = 'PADI' then
        select c.code into v_code
          from public.cert_levels c
         where c.organization = 'PADI' and c.name = v_padi;
      else
        select min(c.code) into v_code
          from public.cert_levels c
          join public.cert_levels padi on padi.id = c.padi_equivalent_id
         where c.organization = v_org
           and padi.organization = 'PADI' and padi.name = v_padi
        having count(*) = 1;
      end if;

      if v_code is not null then
        return v_code;
      end if;
    end if;
  end whole;

  -- Each part on its own (no separator left, so this recurses one level),
  -- highest PADI-equivalent rank first. Only a PADI rung, or a rung that
  -- names one, has a PADI rank (as padiRungOf in src/lib/prereq-shortfall.ts
  -- reads it); an unmapped agency rung's own rank is on another ladder, so it
  -- sorts last rather than outranking a mapped part.
  if p_level ~ '[&/,+]' then
    select m.code into v_code
      from unnest(regexp_split_to_array(p_level, '[&/,+]')) as part(s)
      cross join lateral (select public.cert_level_code_of(p_agency, btrim(part.s)) as code) m
      join public.cert_levels c on c.code = m.code
      left join public.cert_levels padi
        on padi.id = case
                       when c.padi_equivalent_id is not null then c.padi_equivalent_id
                       when c.organization = 'PADI' then c.id
                     end
     order by padi.rank desc nulls last, c.rank desc
     limit 1;
    return v_code;
  end if;

  return null;
end;
$$;

grant execute on function public.cert_level_code_of(text, text) to authenticated, service_role;

-- ── The log records agency rewrites too ─────────────────────────────────────
-- Placing "Padi" + "Advanced Open Water" on PADI's AOW row rewrites both
-- columns through the copy trigger; both old values are kept.
alter table public.profile_value_normalizations
  drop constraint if exists profile_value_normalizations_field_check;
alter table public.profile_value_normalizations
  add constraint profile_value_normalizations_field_check
    check (field in ('cert_level', 'cert_agency', 'nationality'));

-- ── The backfill, re-runnable ───────────────────────────────────────────────
-- For every profile that claims a certification but has no row yet. The
-- candidate spellings, most faithful first:
--
--   * What the diver originally typed, from the 20260910 normalization log —
--     but only while the stored text is still what that pass wrote. "Master
--     Scuba Diver" rewritten to "Rescue" is SDI rung 4, and matching the
--     rewritten "Rescue" would place them a rung too low. If the diver has
--     since edited the field, their edit wins and the log is ignored.
--   * The stored text as it is now — but only when that pass didn't write
--     it. Its rewrite is a reading of the original, so when the original
--     couldn't be placed (ambiguous, or an agency now dropped), placing the
--     rewrite instead would be the very guess the original was left for.
--
-- Returns (matched, unmatched). Rows it cannot place are left untouched.
create or replace function public.backfill_profile_cert_level_codes()
returns table (matched integer, unmatched integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       record;
  v_candidate text;
  v_code      text;
  v_new       record;
begin
  matched   := 0;
  unmatched := 0;

  -- Setting cert_level_code would otherwise stamp application_submitted_at
  -- today on a profile that became complete long ago. A flag the latch reads,
  -- not ALTER TABLE ... DISABLE TRIGGER: that would hold an exclusive lock on
  -- profiles for the whole loop. Transaction-local, cleared at the end.
  perform set_config('fundivers.suppress_application_latch', 'on', true);

  for v_row in
    select p.id, p.cert_agency, p.cert_level
      from public.profiles p
     where p.cert_level_code is null
       and not p.uncertified
       and coalesce(btrim(p.cert_level), '') <> ''
  loop
    v_code := null;

    for v_candidate in
      (select n.old_value
         from public.profile_value_normalizations n
        where n.profile_id = v_row.id
          and n.field      = 'cert_level'
          and n.new_value  = v_row.cert_level
        order by n.applied_at)
      union all
      select v_row.cert_level
       where not exists (
         select 1 from public.profile_value_normalizations n
          where n.profile_id = v_row.id
            and n.field      = 'cert_level'
            and n.new_value  = v_row.cert_level
       )
    loop
      v_code := public.cert_level_code_of(v_row.cert_agency, v_candidate);
      exit when v_code is not null;
    end loop;

    if v_code is null then
      unmatched := unmatched + 1;
      continue;
    end if;

    update public.profiles set cert_level_code = v_code where id = v_row.id
      returning cert_agency, cert_level into v_new;

    if v_new.cert_level is distinct from v_row.cert_level then
      insert into public.profile_value_normalizations (profile_id, field, old_value, new_value)
        values (v_row.id, 'cert_level', v_row.cert_level, v_new.cert_level);
    end if;
    if coalesce(v_row.cert_agency, '') <> '' and v_new.cert_agency is distinct from v_row.cert_agency then
      insert into public.profile_value_normalizations (profile_id, field, old_value, new_value)
        values (v_row.id, 'cert_agency', v_row.cert_agency, v_new.cert_agency);
    end if;

    matched := matched + 1;
  end loop;

  perform set_config('fundivers.suppress_application_latch', '', true);

  return next;
end;
$$;

revoke all on function public.backfill_profile_cert_level_codes() from public, authenticated;
grant execute on function public.backfill_profile_cert_level_codes() to service_role;

-- ── normalize_profile_values() leaves placed rows alone ─────────────────────
-- Its cert pass rewrites text to the PADI rung's name. On a placed row the copy
-- trigger would write the agency's name straight back, and every call would log
-- a change that never happened. Identical to the 20260910 body apart from the
-- `cert_level_code is null` filter, and the latch flag in place of disabling
-- the trigger with DDL.
create or replace function public.normalize_profile_values()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed integer := 0;
  v_row     record;
begin
  -- See backfill_profile_cert_level_codes(): no latch stamps from a cleanup.
  perform set_config('fundivers.suppress_application_latch', 'on', true);

  for v_row in
    select id, cert_level, public.padi_equivalent_of(cert_level) as canonical
      from public.profiles
     where coalesce(btrim(cert_level), '') <> ''
       and cert_level_code is null
  loop
    if v_row.canonical is not null and v_row.canonical <> v_row.cert_level then
      insert into public.profile_value_normalizations (profile_id, field, old_value, new_value)
        values (v_row.id, 'cert_level', v_row.cert_level, v_row.canonical);
      update public.profiles set cert_level = v_row.canonical where id = v_row.id;
      v_changed := v_changed + 1;
    end if;
  end loop;

  for v_row in
    select id, nationality, public.canonical_nationality(nationality) as canonical
      from public.profiles
     where coalesce(btrim(nationality), '') <> ''
  loop
    if v_row.canonical is not null and v_row.canonical <> v_row.nationality then
      insert into public.profile_value_normalizations (profile_id, field, old_value, new_value)
        values (v_row.id, 'nationality', v_row.nationality, v_row.canonical);
      update public.profiles set nationality = v_row.canonical where id = v_row.id;
      v_changed := v_changed + 1;
    end if;
  end loop;

  perform set_config('fundivers.suppress_application_latch', '', true);

  return v_changed;
end;
$$;

-- ── Run it once, here ───────────────────────────────────────────────────────
-- What it cannot place is listed by the query in docs/data-model.md ("A
-- diver's certification"), for an admin to settle by hand.
do $$
declare
  v record;
begin
  select * into v from public.backfill_profile_cert_level_codes();
  raise notice 'backfill_profile_cert_level_codes: placed %, left % for review', v.matched, v.unmatched;
end;
$$;
