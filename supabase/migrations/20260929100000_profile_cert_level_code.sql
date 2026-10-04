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
delete from public.cert_levels where organization = 'TDI';
update public.shop_profile set standards_org = null where standards_org = 'TDI';

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

-- An admin renaming a rung (or its agency) updates every copy of it.
create or replace function public.cert_levels_refresh_profile_copies()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set cert_agency = new.organization,
         cert_level  = new.name
   where cert_level_code = new.code;
  return null;
end;
$$;

drop trigger if exists cert_levels_refresh_profile_copies_trg on public.cert_levels;
create trigger cert_levels_refresh_profile_copies_trg
  after update of name, organization on public.cert_levels
  for each row
  when (old.name is distinct from new.name or old.organization is distinct from new.organization)
  execute function public.cert_levels_refresh_profile_copies();

-- ── The application latch reads the pick, not the text ──────────────────────
-- A legacy string the ladder cannot place is not a certification on file.
create or replace function public.maybe_set_application_submitted_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

  -- Whole string first, then its leading segment ("AOW & nitrox" → "AOW").
  foreach v_reading in array array[
    btrim(p_level),
    btrim((regexp_split_to_array(p_level, '[&/,+]'))[1])
  ]
  loop
    v_key := public.cert_match_key(v_reading);
    continue when v_key is null;

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
    continue when v_org is null and v_orgs is not null;

    -- 2. Via the PADI rung.
    v_padi := public.padi_equivalent_of(v_reading);
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
  end loop;

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
--   * The stored text as it is now.
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
  v_gate      boolean;
begin
  matched   := 0;
  unmatched := 0;

  -- Same reason as normalize_profile_values(): setting cert_level_code would
  -- otherwise stamp application_submitted_at today on a profile that became
  -- complete long ago. A failure rolls this back, DDL included.
  v_gate := exists (
    select 1 from pg_trigger
     where tgrelid = 'public.profiles'::regclass
       and tgname  = 'profiles_maybe_set_submitted_at_trg'
       and not tgisinternal
  );
  if v_gate then
    execute 'alter table public.profiles disable trigger profiles_maybe_set_submitted_at_trg';
  end if;

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

  if v_gate then
    execute 'alter table public.profiles enable trigger profiles_maybe_set_submitted_at_trg';
  end if;

  return next;
end;
$$;

revoke all on function public.backfill_profile_cert_level_codes() from public, authenticated;
grant execute on function public.backfill_profile_cert_level_codes() to service_role;

-- ── normalize_profile_values() leaves placed rows alone ─────────────────────
-- Its cert pass rewrites text to the PADI rung's name. On a placed row the copy
-- trigger would write the agency's name straight back, and every call would log
-- a change that never happened. Identical to the 20260910 body apart from the
-- `cert_level_code is null` filter.
create or replace function public.normalize_profile_values()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed integer := 0;
  v_row     record;
  v_gate    boolean;
begin
  v_gate := exists (
    select 1 from pg_trigger
     where tgrelid = 'public.profiles'::regclass
       and tgname  = 'profiles_maybe_set_submitted_at_trg'
       and not tgisinternal
  );
  if v_gate then
    execute 'alter table public.profiles disable trigger profiles_maybe_set_submitted_at_trg';
  end if;

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

  if v_gate then
    execute 'alter table public.profiles enable trigger profiles_maybe_set_submitted_at_trg';
  end if;

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
