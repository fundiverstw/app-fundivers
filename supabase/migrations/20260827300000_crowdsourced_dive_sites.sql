-- Anyone can add a place, in any language, without making a second Bat Cave.
--
-- The catalog was admin-only, which put a staff member between a diver and the
-- observation they came to file: a site nobody had entered yet meant the
-- almanac form had nowhere to hang it. Opening the catalog is the fix, and
-- everything else here exists to stop that turning into a pile of near-
-- identical rows.
--
-- Three defences, in order of how much they actually help:
--
--   1. Know the real places already. Most "new" sites are not new; they are a
--      site the shop dives every week, typed in by someone who could not find
--      it. The seed that follows this migration loads the shop's whole map,
--      names in every language, so the picker can offer the site instead of a
--      blank field.
--   2. Match what they type against every name in every language, including
--      the aliases below, and offer what it found before the row is written.
--      A warning, not a wall: two genuinely different sites can have similar
--      names, and a diver standing on the shore knows better than a trigram.
--   3. Let an admin merge what still slips through, which is what makes (2)
--      safe to leave as a warning.
--
-- A site a diver adds is live immediately and marked unverified. Waiting for
-- approval would strand the observation that prompted it; hiding the
-- distinction would let one person's guess at a spelling pass for the shop's
-- own catalog.

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;


alter table public.dive_sites
  add column name_zh_tw text,
  add column name_ja text,
  add column latitude  numeric(9, 6),
  add column longitude numeric(9, 6),
  add column verified  boolean not null default false,
  add column created_by uuid references auth.users (id) on delete set null;

comment on column public.dive_sites.name is
  'The site''s English name, and the identifier every surface falls back to.';
comment on column public.dive_sites.verified is
  'Staff have confirmed this is a real, correctly-named place. False on anything a diver added until someone checks it.';

-- Everything already in the catalog got there through the admin-only policy
-- this migration relaxes, so it is verified by construction.
update public.dive_sites set verified = true;

alter table public.dive_sites
  add constraint dive_sites_latitude_range
    check (latitude is null or latitude between -90 and 90),
  add constraint dive_sites_longitude_range
    check (longitude is null or longitude between -180 and 180),
  -- Half a coordinate is not a location, and stored as one it would put the
  -- site on the prime meridian or the equator.
  add constraint dive_sites_coords_complete
    check ((latitude is null) = (longitude is null));


-- Every other name a place answers to: the old shop spelling, the name on the
-- boat captain's chart, a romanization nobody uses any more. These are not
-- shown anywhere. They exist so that typing one of them finds the site that
-- already exists instead of creating its twin.
create table public.dive_site_aliases (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.dive_sites (id) on delete cascade,
  name       text not null,
  -- Which language this spelling is, when that is known. Null is fine and
  -- common: an alias is a string someone might type, not a translation.
  locale     text check (locale is null or locale in ('en', 'zh-TW', 'ja')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create unique index dive_site_aliases_site_name_key
  on public.dive_site_aliases (site_id, lower(name));
create index dive_site_aliases_site_idx on public.dive_site_aliases (site_id);

alter table public.dive_site_aliases enable row level security;

grant select, insert, update, delete on table public.dive_site_aliases to service_role;
grant select on table public.dive_site_aliases to authenticated;

create policy "Authenticated read dive site aliases"
  on public.dive_site_aliases for select
  to authenticated
  using (true);

create policy "Admins write dive site aliases"
  on public.dive_site_aliases for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- The form a name is compared in: case folded, accents removed, and
-- everything that is not a letter or a digit dropped. "Bat Cave", "bat  cave"
-- and "Bat-Cave!" all reduce to batcave, while CJK survives untouched --
-- [:alnum:] is Unicode-aware, so 蝙蝠洞 normalizes to itself.
--
-- STABLE rather than IMMUTABLE because unaccent depends on its dictionary, so
-- this can never back an index. It does not need to: the catalog is a few
-- hundred rows at the outside, and comparing a name against all of them is one
-- sequential scan of a very small table.
create or replace function public.dive_site_match_key(p_name text)
returns text
language sql
stable
set search_path to 'public', 'extensions'
as $$
  select regexp_replace(lower(unaccent(coalesce(p_name, ''))), '[^[:alnum:]]', '', 'g')
$$;

revoke all on function public.dive_site_match_key(text) from public, anon;
grant execute on function public.dive_site_match_key(text) to authenticated, service_role;


-- ── Finding what already exists ────────────────────────────────────
--
-- Every name the catalog knows, in one list: the three display names and every
-- alias. A search compares against all of them, so a diver typing 蝙蝠洞 finds
-- the row whose English name is Bat Cave, and vice versa.
create or replace function public.dive_site_known_names()
returns table (site_id uuid, name text, locale text)
language sql
stable
set search_path to 'public'
as $$
  select s.id, s.name,       'en'    from public.dive_sites s where s.name       is not null
  union all
  select s.id, s.name_zh_tw, 'zh-TW' from public.dive_sites s where s.name_zh_tw is not null
  union all
  select s.id, s.name_ja,    'ja'    from public.dive_sites s where s.name_ja    is not null
  union all
  select a.site_id, a.name, a.locale from public.dive_site_aliases a
$$;

revoke all on function public.dive_site_known_names() from public, anon;
grant execute on function public.dive_site_known_names() to authenticated, service_role;


-- What a diver is about to type in might already be here.
--
-- Scored, best first, so the form can say "did you mean Bat Cave?" before the
-- row is written. An exact match on the comparison key scores 1 whatever the
-- language; below that, trigram similarity does the work, which is why the
-- English spellings catch typos well and the CJK ones mostly catch exact hits
-- (a three-character name has few trigrams to disagree about).
--
-- p_kind narrows to dive sites or adventure locations, because a hiking trail
-- named after a reef is not the reef.
create or replace function public.find_similar_dive_sites(
  p_name      text,
  p_kind      text default null,
  p_threshold real default 0.4,
  p_limit     integer default 5
)
returns table (
  id           uuid,
  name         text,
  name_zh_tw   text,
  name_ja      text,
  kind         text,
  region       text,
  verified     boolean,
  active       boolean,
  matched_name text,
  score        real
)
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $$
  with needle as (
    select public.dive_site_match_key(p_name) as key
  ),
  scored as (
    select k.site_id,
           k.name as matched_name,
           case when public.dive_site_match_key(k.name) = needle.key
                then 1::real
                else similarity(public.dive_site_match_key(k.name), needle.key)
           end as score
      from public.dive_site_known_names() k
      cross join needle
     where needle.key <> ''
  ),
  best as (
    select site_id, matched_name, score,
           row_number() over (partition by site_id order by score desc, matched_name) as rn
      from scored
     where score >= p_threshold
  )
  select s.id, s.name, s.name_zh_tw, s.name_ja, s.kind, s.region,
         s.verified, s.active, b.matched_name, b.score
    from best b
    join public.dive_sites s on s.id = b.site_id
   where b.rn = 1
     and (p_kind is null or s.kind = p_kind)
   order by b.score desc, s.name
   limit greatest(p_limit, 1);
$$;

revoke all on function public.find_similar_dive_sites(text, text, real, integer) from public, anon;
grant execute on function public.find_similar_dive_sites(text, text, real, integer) to authenticated, service_role;


-- ── Adding one ─────────────────────────────────────────────────────
--
-- An RPC rather than an INSERT policy, for the same reason the almanac writes
-- through one: `verified` and `created_by` are claims about the row that the
-- row's author must not get to make. A diver posting straight to the table
-- could mark their own guess as staff-confirmed.
create or replace function public.create_dive_site(
  p_name       text,
  p_kind       text,
  p_name_zh_tw text default null,
  p_name_ja    text default null,
  p_region     text default null,
  p_latitude   numeric default null,
  p_longitude  numeric default null,
  p_aliases    text[] default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_site_id uuid;
  v_alias   text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'a place needs a name' using errcode = '23514';
  end if;

  insert into public.dive_sites (
    name, kind, name_zh_tw, name_ja, region, latitude, longitude,
    verified, created_by
  ) values (
    btrim(p_name), p_kind,
    nullif(btrim(coalesce(p_name_zh_tw, '')), ''),
    nullif(btrim(coalesce(p_name_ja, '')), ''),
    nullif(btrim(coalesce(p_region, '')), ''),
    p_latitude, p_longitude,
    -- Staff adding a place ARE the verification. A diver's is provisional
    -- until someone who knows the coastline says otherwise.
    public.is_admin(),
    auth.uid()
  ) returning id into v_site_id;

  foreach v_alias in array coalesce(p_aliases, array[]::text[]) loop
    if coalesce(btrim(v_alias), '') <> '' then
      insert into public.dive_site_aliases (site_id, name, created_by)
      values (v_site_id, btrim(v_alias), auth.uid())
      on conflict do nothing;
    end if;
  end loop;

  return v_site_id;
end;
$$;

revoke all on function public.create_dive_site(text, text, text, text, text, numeric, numeric, text[])
  from public, anon;
grant execute on function public.create_dive_site(text, text, text, text, text, numeric, numeric, text[])
  to authenticated, service_role;


-- ── Cleaning up after the warning was ignored ──────────────────────

create or replace function public.verify_dive_site(p_site_id uuid, p_verified boolean default true)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  update public.dive_sites set verified = p_verified, updated_at = now() where id = p_site_id;
end;
$$;

revoke all on function public.verify_dive_site(uuid, boolean) from public, anon;
grant execute on function public.verify_dive_site(uuid, boolean) to authenticated, service_role;


-- Fold one site into another and keep every observation ever filed against it.
--
-- The duplicate's names do not disappear; they become aliases of the survivor,
-- which is the whole point. Whatever spelling led someone to create the twin
-- will now find the real site, so the same mistake cannot be made twice.
--
-- The one thing that cannot be carried over is a collision: the almanac allows
-- one record per diver per place per day, so a diver who filed against both
-- halves of a duplicated site on the same day has two rows that cannot both
-- survive. The survivor's own record is kept and the duplicate's is dropped —
-- they describe the same diver, at the same place, on the same day, and
-- keeping the row already attached to the surviving site is the choice that
-- changes nothing about what that site's history says.
create or replace function public.merge_dive_sites(p_keep uuid, p_merge uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_kept   public.dive_sites%rowtype;
  v_merged public.dive_sites%rowtype;
begin
  if not public.is_admin() then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if p_keep = p_merge then
    raise exception 'a place cannot be merged into itself' using errcode = '23514';
  end if;

  select * into v_kept from public.dive_sites where id = p_keep;
  if not found then raise exception 'place to keep not found' using errcode = 'no_data_found'; end if;
  select * into v_merged from public.dive_sites where id = p_merge;
  if not found then raise exception 'place to merge not found' using errcode = 'no_data_found'; end if;

  -- Every name the duplicate answered to becomes a name the survivor answers
  -- to, so the search that should have prevented this finds it next time.
  insert into public.dive_site_aliases (site_id, name, locale, created_by)
  select p_keep, n.name, n.locale, auth.uid()
    from public.dive_site_known_names() n
   where n.site_id = p_merge
     and public.dive_site_match_key(n.name) <> ''
  on conflict do nothing;

  -- Anything the survivor was missing and the duplicate had.
  update public.dive_sites
     set name_zh_tw = coalesce(name_zh_tw, v_merged.name_zh_tw),
         name_ja    = coalesce(name_ja,    v_merged.name_ja),
         region     = coalesce(region,     v_merged.region),
         latitude   = coalesce(latitude,   v_merged.latitude),
         longitude  = coalesce(longitude,  v_merged.longitude),
         updated_at = now()
   where id = p_keep;

  delete from public.almanac_records dup
   where dup.site_id = p_merge
     and exists (
       select 1 from public.almanac_records keep
        where keep.site_id  = p_keep
          and keep.obs_date = dup.obs_date
          and keep.diver_id = dup.diver_id
     );

  update public.almanac_records set site_id = p_keep where site_id = p_merge;
  update public.coral_surveys  set site_id = p_keep where site_id = p_merge;
  update public.events         set site_id = p_keep where site_id = p_merge;

  delete from public.dive_sites where id = p_merge;
end;
$$;

revoke all on function public.merge_dive_sites(uuid, uuid) from public, anon;
grant execute on function public.merge_dive_sites(uuid, uuid) to authenticated, service_role;
