-- Dive-site maps, kept.
--
-- The renderer, the editor and the whole model have existed for a while behind
-- a development-only route: a diver could place depths, look at the surface
-- they produced, and lose all of it on reload, because nothing was ever
-- written down. This is the storage that was missing, and the thing that turns
-- a workbench into a feature.
--
-- Four tables rather than one document, for the reason the model is not a
-- raster: a map is not a picture, it is an accumulation of separate
-- observations by different people on different days, and every one of them
-- has to stay individually attributable forever. A jsonb blob per site would
-- make "who measured this, and when" unanswerable the moment two divers
-- touched the same site.
--
--   dive_site_maps           the frame: where local (0,0) is on Earth, which
--                            way +y points, how far the site extends, and the
--                            provenance of the drawing it started from.
--   dive_site_contributions  one submission — the commit a batch arrived in.
--   dive_site_soundings      depths.
--   dive_site_features       rocks, walls, arches, swim-throughs.
--
-- The lattice stays implicit. Divers correct depths on a 1 m grid whose
-- positions have no rows until somebody puts a reading on one; a kilometre of
-- coastline at 1 m spacing would otherwise be a million rows of nothing. The
-- id is derived from the coordinate (`lat:x:y`, see latticeId in
-- src/lib/dive-site-map.ts), which is what makes it a correction rather than a
-- duplicate when two divers measure the same square metre: they generate the
-- same id, and the primary key reconciles them.


create table public.dive_site_maps (
  site_id      uuid primary key references public.dive_sites (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- How far the site reaches from its origin, so an empty site has a canvas
  -- without anybody inventing data to fill it.
  extent_m     numeric(8, 1),
  -- WGS84 position of local (0,0). Null means the map is internally
  -- consistent but not placed on Earth, which is the honest state of a
  -- hand-drawn plan nobody has georeferenced.
  origin_lat   numeric(9, 6),
  origin_lng   numeric(9, 6),
  -- Degrees the local +y axis is rotated east of true north.
  rotation_deg numeric(5, 2),
  -- Who drew the thing this site started from, and under what terms. A
  -- hand-drawn source routinely carries its own accuracy disclaimer and a
  -- licence that permits study but not publication; dropping either would be
  -- both wrong and rude.
  provenance   jsonb not null default '{}'::jsonb,
  -- Bearings and entry points come off the original drawing rather than from
  -- divers -- the editor does not produce them -- so they live here rather
  -- than in tables nothing would ever write to.
  bearings     jsonb not null default '[]'::jsonb,
  entries      jsonb not null default '[]'::jsonb,
  constraint dive_site_maps_origin_complete
    check ((origin_lat is null) = (origin_lng is null))
);


-- One submission. The equivalent of the commit a line of code arrived in:
-- every sounding and feature points back at the batch it came in on, so a
-- contribution can be read, credited, or backed out as a unit.
create table public.dive_site_contributions (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.dive_sites (id) on delete cascade,
  diver_id   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  note       text,
  -- Same treatment the place catalog gets: a diver's readings are live
  -- immediately, because the point of crowdsourcing them is that they are
  -- useful before anyone has time to check, and marked until someone does.
  verified   boolean not null default false
);

create index dive_site_contributions_site_idx on public.dive_site_contributions (site_id, created_at desc);
create index dive_site_contributions_diver_idx on public.dive_site_contributions (diver_id);


create table public.dive_site_soundings (
  -- Derived from the coordinate, not generated: two divers who measure the
  -- same square metre produce the same id, and the primary key makes that a
  -- reconciliation instead of a duplicate.
  id              text not null,
  site_id         uuid not null references public.dive_sites (id) on delete cascade,
  x               numeric(10, 2) not null,
  y               numeric(10, 2) not null,
  -- Meters below `datum`, positive downward.
  depth_m         numeric(6, 2) not null check (depth_m >= 0),
  datum           text not null default 'instantaneous'
                    check (datum in ('unknown', 'TWCD2021', 'instantaneous')),
  -- Load-bearing rather than metadata: a dive computer reports depth below
  -- whatever surface it was under at that moment, so an instantaneous reading
  -- can only be reduced to a chart datum if the state of tide is known, and
  -- the state of tide can only be recovered from the time.
  observed_at     timestamptz,
  source          text not null
                    check (source in ('hand_drawn', 'diver', 'survey', 'placeholder')),
  contribution_id uuid references public.dive_site_contributions (id) on delete set null,
  -- The scaffold point this reading replaces, when a diver corrected one of
  -- the starting grid points rather than adding a new position.
  supersedes      text,
  uncertainty_m   numeric(6, 2),
  created_at      timestamptz not null default now(),
  primary key (site_id, id)
);

create index dive_site_soundings_contribution_idx on public.dive_site_soundings (contribution_id);


create table public.dive_site_features (
  id              text not null,
  site_id         uuid not null references public.dive_sites (id) on delete cascade,
  kind            text not null check (kind in (
                    'rock', 'slope', 'wall', 'sand', 'formation', 'boundary',
                    'hazard', 'arch', 'swim_through', 'overhang', 'cave')),
  shape           text not null check (shape in ('point', 'path', 'area')),
  -- [{x, y}, …]. A point is a one-element array, so every shape reads the
  -- same way and nothing has to branch on which column to look in.
  points          jsonb not null,
  -- Shown as drawn. Local names ("龍頭", "Dragon Head") are user-generated
  -- content and are never translated.
  label           text,
  source          text not null
                    check (source in ('hand_drawn', 'diver', 'survey', 'placeholder')),
  contribution_id uuid references public.dive_site_contributions (id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (site_id, id),
  constraint dive_site_features_points_nonempty
    check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) > 0)
);

create index dive_site_features_contribution_idx on public.dive_site_features (contribution_id);


create or replace function public.touch_dive_site_map_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_dive_site_maps_touch_updated_at
  before update on public.dive_site_maps
  for each row execute function public.touch_dive_site_map_updated_at();


-- ── Access ─────────────────────────────────────────────────────────
--
-- Read by any signed-in diver; written only through the RPC below, for the
-- same reason the almanac and the place catalog are: `diver_id`, `source` and
-- `verified` are claims about a record that the record's author must not be
-- the one making.

alter table public.dive_site_maps          enable row level security;
alter table public.dive_site_contributions enable row level security;
alter table public.dive_site_soundings     enable row level security;
alter table public.dive_site_features      enable row level security;

grant select on table public.dive_site_maps          to authenticated;
grant select on table public.dive_site_contributions to authenticated;
grant select on table public.dive_site_soundings     to authenticated;
grant select on table public.dive_site_features      to authenticated;

grant select, insert, update, delete on table public.dive_site_maps          to service_role;
grant select, insert, update, delete on table public.dive_site_contributions to service_role;
grant select, insert, update, delete on table public.dive_site_soundings     to service_role;
grant select, insert, update, delete on table public.dive_site_features      to service_role;

create policy "Authenticated read site maps" on public.dive_site_maps
  for select to authenticated using (true);
create policy "Authenticated read site contributions" on public.dive_site_contributions
  for select to authenticated using (true);
create policy "Authenticated read site soundings" on public.dive_site_soundings
  for select to authenticated using (true);
create policy "Authenticated read site features" on public.dive_site_features
  for select to authenticated using (true);

create policy "Admins write site maps" on public.dive_site_maps
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins write site contributions" on public.dive_site_contributions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins write site soundings" on public.dive_site_soundings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins write site features" on public.dive_site_features
  for all to authenticated using (public.is_admin()) with check (public.is_admin());


-- ── Contributing ───────────────────────────────────────────────────

/*
 * File one batch of readings against a site.
 *
 * Soundings land by (site_id, id), and the id is the lattice coordinate, so a
 * diver correcting a square metre somebody already measured overwrites it
 * rather than stacking a second reading on the same spot. That is the intended
 * behaviour and the reason the id is derived: the newest measurement of a
 * place is the one the map should draw. The superseded record is not lost —
 * the contribution it arrived on still names its author and its day.
 *
 * `source` is forced to 'diver' whoever calls. A contribution is by definition
 * a diver's observation; hand-drawn and survey records come from a migration
 * or an admin, not from this path.
 */
create or replace function public.submit_site_map_contribution(
  p_site_id   uuid,
  p_soundings jsonb default '[]'::jsonb,
  p_features  jsonb default '[]'::jsonb,
  p_note      text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_contribution uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not exists (select 1 from public.dive_sites where id = p_site_id) then
    raise exception 'place not found' using errcode = 'no_data_found';
  end if;

  if coalesce(jsonb_array_length(p_soundings), 0) = 0
     and coalesce(jsonb_array_length(p_features), 0) = 0 then
    raise exception 'a contribution needs at least one reading' using errcode = '23514';
  end if;

  insert into public.dive_site_contributions (site_id, diver_id, note, verified)
  values (p_site_id, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''), public.is_admin())
  returning id into v_contribution;

  insert into public.dive_site_soundings (
    id, site_id, x, y, depth_m, datum, observed_at, source,
    contribution_id, supersedes, uncertainty_m
  )
  select s.value ->> 'id',
         p_site_id,
         (s.value -> 'at' ->> 'x')::numeric,
         (s.value -> 'at' ->> 'y')::numeric,
         (s.value ->> 'depth_m')::numeric,
         coalesce(s.value ->> 'datum', 'instantaneous'),
         nullif(s.value ->> 'observed_at', '')::timestamptz,
         'diver',
         v_contribution,
         nullif(s.value ->> 'supersedes', ''),
         nullif(s.value ->> 'uncertainty_m', '')::numeric
    from jsonb_array_elements(coalesce(p_soundings, '[]'::jsonb)) s
  on conflict (site_id, id) do update
    set x               = excluded.x,
        y               = excluded.y,
        depth_m         = excluded.depth_m,
        datum           = excluded.datum,
        observed_at     = excluded.observed_at,
        source          = excluded.source,
        contribution_id = excluded.contribution_id,
        supersedes      = excluded.supersedes,
        uncertainty_m   = excluded.uncertainty_m;

  insert into public.dive_site_features (
    id, site_id, kind, shape, points, label, source, contribution_id
  )
  select f.value ->> 'id',
         p_site_id,
         f.value ->> 'kind',
         f.value -> 'geometry' ->> 'shape',
         case
           when f.value -> 'geometry' ->> 'shape' = 'point'
             then jsonb_build_array(f.value -> 'geometry' -> 'at')
           else coalesce(f.value -> 'geometry' -> 'points', '[]'::jsonb)
         end,
         nullif(f.value ->> 'label', ''),
         'diver',
         v_contribution
    from jsonb_array_elements(coalesce(p_features, '[]'::jsonb)) f
  on conflict (site_id, id) do update
    set kind            = excluded.kind,
        shape           = excluded.shape,
        points          = excluded.points,
        label           = excluded.label,
        source          = excluded.source,
        contribution_id = excluded.contribution_id;

  -- A site gets its map row the first time anybody records anything on it, so
  -- an admin does not have to create one before a diver may contribute.
  insert into public.dive_site_maps (site_id) values (p_site_id)
  on conflict (site_id) do nothing;

  return v_contribution;
end;
$$;

revoke all on function public.submit_site_map_contribution(uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.submit_site_map_contribution(uuid, jsonb, jsonb, text) to authenticated, service_role;


create or replace function public.verify_site_map_contribution(
  p_contribution_id uuid, p_verified boolean default true
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  update public.dive_site_contributions
     set verified = p_verified
   where id = p_contribution_id;
end;
$$;

revoke all on function public.verify_site_map_contribution(uuid, boolean) from public, anon;
grant execute on function public.verify_site_map_contribution(uuid, boolean) to authenticated, service_role;
