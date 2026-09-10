-- Clean the free text divers typed into `profiles.cert_level` and
-- `profiles.nationality`, so the stored value says what the dashboard already
-- says about it.
--
-- The BI panes canonicalize on read (src/lib/cert-level.ts, src/lib/nationality.ts).
-- That keeps the charts honest but leaves the rows themselves holding twenty
-- spellings of six certifications, which every other reader — an export, a
-- manifest, a future query — has to re-derive or get wrong. This writes the
-- answer down.
--
-- Read-time canonicalization stays. Divers keep typing whatever they type, so
-- the next signup re-introduces the mess; this fixes history, the resolver
-- handles the future.
--
-- Three deliberate limits:
--
--   * Nothing is guessed. A value the ladder cannot place — "PE40", an
--     FFESSM grade no agency row names — is left exactly as it was. Writing a
--     rung a diver never earned would be worse than leaving an untidy label,
--     and the untidy label is what tells an admin to go and ask them.
--   * Every change is logged with its old value, so this is reversible without
--     restoring a backup.
--   * Idempotent. A second run finds every row already canonical and writes
--     nothing.

-- ── The record of what was changed ──────────────────────────────────────────
create table if not exists public.profile_value_normalizations (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  field        text not null check (field in ('cert_level', 'nationality')),
  old_value    text not null,
  new_value    text not null,
  applied_at   timestamptz not null default now()
);

create index if not exists profile_value_normalizations_profile_idx
  on public.profile_value_normalizations (profile_id);

alter table public.profile_value_normalizations enable row level security;

-- Admin-only: it is a log of edits to other people's profiles.
grant select on public.profile_value_normalizations to authenticated;
grant all    on public.profile_value_normalizations to service_role;

drop policy if exists "Admins read the normalization log" on public.profile_value_normalizations;
create policy "Admins read the normalization log"
  on public.profile_value_normalizations for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ));

-- ── Comparison key ──────────────────────────────────────────────────────────
-- Lowercase, alphanumerics only, a trailing "diver" dropped so "Advanced Open
-- Water Diver" and "Advanced Open Water" agree, and the common "advance" typo
-- repaired so "Advance Adventure Diver" reaches SDI's "Advanced Adventure
-- Diver". Mirrors `key()` in src/lib/cert-level.ts — the integration test in
-- tests/integration/profile-normalization.test.ts fails if the two disagree.
create or replace function public.cert_match_key(p_value text)
returns text
language sql
immutable
as $$
  select case
    when k = ''                                   then null
    when k <> 'diver' and k like '%diver'         then left(k, length(k) - 5)
    else k
  end
  from (
    select case
      when raw like 'advance%' and raw not like 'advanced%' then 'advanced' || substr(raw, 8)
      else raw
    end as k
    from (select regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]', '', 'g') as raw) r
  ) t;
$$;

-- ── Certification → the PADI rung the shop's own ladder names ───────────────
-- The answer lives in `cert_levels`: every agency's rungs, each carrying a
-- `padi_equivalent_id`. Matching means finding the row whose name or code the
-- diver typed and following that pointer — not a second opinion kept in code.
--
-- Returns null when nothing matches, which the caller must read as "leave it
-- alone", never as "unknown".
create or replace function public.padi_equivalent_of(p_value text)
returns text
language plpgsql
stable
as $$
declare
  v_reading  text;
  v_key      text;
  v_code     text;
  v_name     text;
begin
  if coalesce(btrim(p_value), '') = '' then
    return null;
  end if;

  -- The whole string first, then its leading segment. "AOW & nitrox" is an AOW
  -- diver who also holds a specialty and "OW/Scuba Diver" is someone hedging
  -- between two names for one rung — but an agency really does name a rung
  -- "Open Water / Dive Con Instructor", so the whole string gets first refusal.
  foreach v_reading in array array[
    btrim(p_value),
    btrim((regexp_split_to_array(p_value, '[&/,+]'))[1])
  ]
  loop
    v_key := public.cert_match_key(v_reading);
    continue when v_key is null;

    -- Shorthand no agency spells out. Everything an agency does name is matched
    -- against the ladder below, so this list stays short.
    v_code := case v_key
      when 'owd'             then 'open_water'
      when 'rd'              then 'rescue'
      when 'owinstructor'    then 'instructor'
      when 'owsi'            then 'instructor'
      when 'staffinstructor' then 'idc_staff'
      when 'cd'              then 'course_director'
      else null
    end;

    if v_code is not null then
      select padi.name into v_name
        from public.cert_levels src
        join public.cert_levels padi
          on padi.id = coalesce(src.padi_equivalent_id, src.id)
       where src.code = v_code;
      if v_name is not null then
        return v_name;
      end if;
    end if;

    -- Ordered so the answer never depends on the order rows come back in.
    select padi.name into v_name
      from public.cert_levels src
      join public.cert_levels padi
        on padi.id = coalesce(src.padi_equivalent_id, src.id)
     where public.cert_match_key(src.name) = v_key
        or public.cert_match_key(src.code) = v_key
     order by src.organization, src.rank
     limit 1;

    if v_name is not null then
      return v_name;
    end if;
  end loop;

  return null;
end;
$$;

-- ── Nationality → the canonical English country name ────────────────────────
-- Both the country and the demonym are accepted, because the field has always
-- taken either. Mirrors src/lib/nationality.ts; same integration test holds the
-- two together. Returns null when unrecognized — "leave it alone".
create or replace function public.canonical_nationality(p_value text)
returns text
language sql
stable
as $$
  select c.country
    from (values
      ('Taiwan',         array['taiwan','taiwanese','roc','republicofchina','tw','formosa']),
      ('United States',  array['usa','us','unitedstates','unitedstatesofamerica','america','american']),
      ('United Kingdom', array['uk','unitedkingdom','britain','greatbritain','british','england','english','gb','scotland','scottish','wales','welsh']),
      ('Ireland',        array['ireland','irish','eire']),
      ('China',          array['china','chinese','prc','peoplesrepublicofchina','cn']),
      ('Hong Kong',      array['hongkong','hk','hongkonger']),
      ('Macau',          array['macau','macao']),
      ('Japan',          array['japan','japanese','jp','nippon']),
      ('South Korea',    array['korea','southkorea','korean','republicofkorea','kr']),
      ('Canada',         array['canada','canadian','ca']),
      ('Australia',      array['australia','australian','aussie','au']),
      ('New Zealand',    array['newzealand','kiwi','nz']),
      ('Germany',        array['germany','german','deutschland','de']),
      ('France',         array['france','french','fr']),
      ('Italy',          array['italy','italian','it']),
      ('Spain',          array['spain','spanish','espana','es']),
      ('Portugal',       array['portugal','portuguese','pt']),
      ('Netherlands',    array['netherlands','dutch','holland','nl']),
      ('Belgium',        array['belgium','belgian','be']),
      ('Switzerland',    array['switzerland','swiss','ch']),
      ('Austria',        array['austria','austrian','at']),
      ('Poland',         array['poland','polish','pl']),
      ('Czechia',        array['czechia','czech','czechrepublic','cz']),
      ('Croatia',        array['croatia','croatian','hr']),
      ('Sweden',         array['sweden','swedish','se']),
      ('Norway',         array['norway','norwegian','no']),
      ('Denmark',        array['denmark','danish','dk']),
      ('Finland',        array['finland','finnish','fi']),
      ('Russia',         array['russia','russian','ru']),
      ('Ukraine',        array['ukraine','ukrainian','ua']),
      ('Israel',         array['israel','israeli','il']),
      ('Turkey',         array['turkey','turkish','turkiye','tr']),
      ('South Africa',   array['southafrica','southafrican','za']),
      ('Mexico',         array['mexico','mexican','mx']),
      ('Brazil',         array['brazil','brazilian','brasil','br']),
      ('Argentina',      array['argentina','argentinian','argentine','ar']),
      ('Chile',          array['chile','chilean','cl']),
      ('Philippines',    array['philippines','filipino','filipina','ph']),
      ('Malaysia',       array['malaysia','malaysian','my']),
      ('Singapore',      array['singapore','singaporean','sg']),
      ('Indonesia',      array['indonesia','indonesian','id']),
      ('Thailand',       array['thailand','thai','th']),
      ('Vietnam',        array['vietnam','vietnamese','vietnam','vn']),
      ('India',          array['india','indian','in']),
      ('Nepal',          array['nepal','nepali','nepalese'])
    ) as c(country, aliases)
   where regexp_replace(lower(coalesce(p_value, '')), '[^a-z]', '', 'g') = any(c.aliases)
   limit 1;
$$;

grant execute on function public.cert_match_key(text)        to authenticated, service_role;
grant execute on function public.padi_equivalent_of(text)    to authenticated, service_role;
grant execute on function public.canonical_nationality(text) to authenticated, service_role;

-- ── The one-time pass, re-runnable ──────────────────────────────────────────
-- Rewrites only what resolves to something different from what is stored, logs
-- the old value, and returns how many rows it touched. A shop importing legacy
-- profiles later can call it again.
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
  -- `profiles_maybe_set_submitted_at_trg` stamps `application_submitted_at`
  -- the first time a profile carries every field an application needs — and it
  -- fires on any update, including this one. Rewriting "Advanced Scuba Diver"
  -- to "AOW" does not change whether the profile is complete, so letting it
  -- fire would move a diver's application date to today and, on a deployment
  -- that gates its approvals queue on that column, drop them into it. Recording
  -- a spelling correction as an application is a worse falsehood than the
  -- untidy spelling.
  --
  -- Any failure below rolls the whole call back, DDL included, so the trigger
  -- cannot be left disabled.
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

revoke all on function public.normalize_profile_values() from public, authenticated;
grant execute on function public.normalize_profile_values() to service_role;

-- Run it once, here, over whatever this deployment is already holding. A fresh
-- database has nothing to fix and this is a no-op.
do $$
declare
  v_changed integer;
begin
  v_changed := public.normalize_profile_values();
  raise notice 'normalize_profile_values: rewrote % profile value(s)', v_changed;
end;
$$;
