-- Dive-site maps are staff-facing for now.
--
-- 20260827500000 opened them to every signed-in diver, on the reasoning that a
-- crowdsourced seabed wants a crowd. That is the intended destination, not the
-- state to ship: the editor puts a diver one tap from writing a depth onto a
-- shared map, and until the shop has looked at what that produces, the people
-- doing it should be the people who can also undo it.
--
-- Read as well as write. "Not available yet" has to mean the data too, or the
-- restriction is a hidden button rather than a closed door — the tables are
-- readable straight from PostgREST by anyone with a session.
--
-- Nothing is dropped and nothing is migrated: the tables, the lattice and the
-- contribution model are unchanged, and opening this back up is a policy swap
-- and a route guard whenever the shop wants it.

drop policy if exists "Authenticated read site maps"          on public.dive_site_maps;
drop policy if exists "Authenticated read site contributions" on public.dive_site_contributions;
drop policy if exists "Authenticated read site soundings"     on public.dive_site_soundings;
drop policy if exists "Authenticated read site features"      on public.dive_site_features;

create policy "Admins read site maps" on public.dive_site_maps
  for select to authenticated using (public.is_admin());
create policy "Admins read site contributions" on public.dive_site_contributions
  for select to authenticated using (public.is_admin());
create policy "Admins read site soundings" on public.dive_site_soundings
  for select to authenticated using (public.is_admin());
create policy "Admins read site features" on public.dive_site_features
  for select to authenticated using (public.is_admin());


-- The RPC is the only way in, so this is the line that actually closes it. A
-- SECURITY DEFINER function runs past RLS by design; without its own check, a
-- diver who found the endpoint could still file readings into a map they
-- cannot read.
--
-- `verified` keeps its meaning rather than being hardcoded true: the
-- contribution model is unchanged and staff can still mark each other's
-- batches checked, which is what makes reopening this to divers a policy swap
-- rather than a rewrite.
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

  if not public.is_admin() then
    raise exception 'admin role required' using errcode = '42501';
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

  insert into public.dive_site_maps (site_id) values (p_site_id)
  on conflict (site_id) do nothing;

  return v_contribution;
end;
$$;

revoke all on function public.submit_site_map_contribution(uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.submit_site_map_contribution(uuid, jsonb, jsonb, text) to authenticated, service_role;
