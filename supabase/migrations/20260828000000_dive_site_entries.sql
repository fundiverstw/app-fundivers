-- Ways into the water, as records rather than as a field on the map.
--
-- `dive_site_maps.entries` was a jsonb array, and the reasoning at the time
-- was that entry points come off the original hand-drawn plan rather than from
-- divers -- so there was nothing to attribute and nowhere for it to come from.
-- That has stopped being true: a diver marks the slipway they got in at, and a
-- site has as many ways in as it has ways in. The moment the editor produces
-- them they need what every other observation here has: who said so, which
-- submission it arrived on, and an id derived from the coordinate so that two
-- divers marking one slipway are agreeing rather than each adding one.
--
-- The jsonb column goes with it. Nothing wrote it, and leaving a second place
-- an entry could live is how a site ends up with two answers to "where do you
-- get in".

create table public.dive_site_entries (
  -- `ent:x:y` off the 1 m lattice, the same way soundings are keyed. See
  -- entryId in src/lib/dive-site-map.ts.
  id              text not null,
  site_id         uuid not null references public.dive_sites (id) on delete cascade,
  x               numeric(10, 2) not null,
  y               numeric(10, 2) not null,
  -- What the divers call it: the slipway, the steps, the gully. Local names
  -- are user-generated content and are never translated.
  label           text,
  source          text not null
                    check (source in ('hand_drawn', 'diver', 'survey', 'placeholder')),
  contribution_id uuid references public.dive_site_contributions (id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (site_id, id)
);

create index dive_site_entries_contribution_idx on public.dive_site_entries (contribution_id);

-- Whatever a site already carried in the jsonb column keeps its position and
-- its name, and is honest about where it came from: off the drawing, by nobody
-- this system can name.
insert into public.dive_site_entries (id, site_id, x, y, label, source)
select coalesce(e.value ->> 'id', 'ent:' || (e.value -> 'at' ->> 'x') || ':' || (e.value -> 'at' ->> 'y')),
       m.site_id,
       (e.value -> 'at' ->> 'x')::numeric,
       (e.value -> 'at' ->> 'y')::numeric,
       nullif(e.value ->> 'label', ''),
       'hand_drawn'
  from public.dive_site_maps m
  cross join lateral jsonb_array_elements(coalesce(m.entries, '[]'::jsonb)) e
 where jsonb_typeof(m.entries) = 'array'
on conflict (site_id, id) do nothing;

alter table public.dive_site_maps drop column entries;


alter table public.dive_site_entries enable row level security;

grant select on table public.dive_site_entries to authenticated;
grant select, insert, update, delete on table public.dive_site_entries to service_role;

-- Admin-only read, matching what 20260827600000 did to the other four: dive-
-- site maps are staff-facing until the shop has looked at what the editor
-- produces, and "not available yet" has to mean the data and not just the
-- button.
create policy "Admins read site entries" on public.dive_site_entries
  for select to authenticated using (public.is_admin());
create policy "Admins write site entries" on public.dive_site_entries
  for all to authenticated using (public.is_admin()) with check (public.is_admin());


-- ── Contributing ───────────────────────────────────────────────────
--
-- Replaced rather than overloaded: a default on a new argument would leave two
-- functions of the same name, and PostgREST picks between overloads by the
-- keys the caller sent, which is a coin toss nobody wants in the write path.

drop function if exists public.submit_site_map_contribution(uuid, jsonb, jsonb, text);

create or replace function public.submit_site_map_contribution(
  p_site_id   uuid,
  p_soundings jsonb default '[]'::jsonb,
  p_features  jsonb default '[]'::jsonb,
  p_entries   jsonb default '[]'::jsonb,
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

  -- Kept from 20260827600000, and the line that actually closes this: a
  -- SECURITY DEFINER function runs past RLS by design, so without its own
  -- check a diver who found the endpoint could file into a map they cannot
  -- even read.
  if not public.is_admin() then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  if not exists (select 1 from public.dive_sites where id = p_site_id) then
    raise exception 'place not found' using errcode = 'no_data_found';
  end if;

  -- An entry point on its own is a contribution. A diver who can only say
  -- "this is where you get in" has said something the site did not know.
  if coalesce(jsonb_array_length(p_soundings), 0) = 0
     and coalesce(jsonb_array_length(p_features), 0) = 0
     and coalesce(jsonb_array_length(p_entries), 0) = 0 then
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

  -- Same reconciliation the soundings get, and for the same reason: the id is
  -- the lattice position, so the second diver to mark a slipway is confirming
  -- it and may correct the name, not adding a second one beside it.
  insert into public.dive_site_entries (
    id, site_id, x, y, label, source, contribution_id
  )
  select e.value ->> 'id',
         p_site_id,
         (e.value -> 'at' ->> 'x')::numeric,
         (e.value -> 'at' ->> 'y')::numeric,
         nullif(e.value ->> 'label', ''),
         'diver',
         v_contribution
    from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e
  on conflict (site_id, id) do update
    set x               = excluded.x,
        y               = excluded.y,
        label           = coalesce(excluded.label, public.dive_site_entries.label),
        source          = excluded.source,
        contribution_id = excluded.contribution_id;

  -- A site gets its map row the first time anybody records anything on it, so
  -- an admin does not have to create one before a diver may contribute.
  insert into public.dive_site_maps (site_id) values (p_site_id)
  on conflict (site_id) do nothing;

  return v_contribution;
end;
$$;

revoke all on function public.submit_site_map_contribution(uuid, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.submit_site_map_contribution(uuid, jsonb, jsonb, jsonb, text) to authenticated, service_role;
