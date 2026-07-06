-- RLS policies for events + junctions. Supabase auto-enables RLS and grants
-- anon/authenticated SELECT on new public tables, but the expand migration added
-- no policies — so every row was filtered out for the anon key (public site
-- reads + the Wix sync saw zero rows). Mirror the EO_dives / eo_dive_addons
-- policy set: public SELECT, admin-only writes. Idempotent (drop-then-create).

begin;

-- Explicit grants (prod auto-granted anon/authenticated SELECT via Supabase
-- default privileges; local dev did not — grant explicitly so both match).
grant select on public.events, public.event_addons, public.event_rooms, public.event_destinations to anon, authenticated;
grant insert, update, delete on public.events, public.event_addons, public.event_rooms, public.event_destinations to authenticated;

alter table public.events enable row level security;
drop policy if exists "events: public select" on public.events;
drop policy if exists "events: admin insert" on public.events;
drop policy if exists "events: admin update" on public.events;
drop policy if exists "events: admin delete" on public.events;
create policy "events: public select" on public.events for select using (true);
create policy "events: admin insert" on public.events for insert with check (is_admin());
create policy "events: admin update" on public.events for update using (is_admin()) with check (is_admin());
create policy "events: admin delete" on public.events for delete using (is_admin());

do $$
declare t text;
begin
  foreach t in array array['event_addons','event_rooms','event_destinations']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || ': public read', t);
    execute format('drop policy if exists %I on public.%I', t || ': admin write', t);
    execute format('create policy %I on public.%I for select using (true)', t || ': public read', t);
    execute format('create policy %I on public.%I for all using (is_admin()) with check (is_admin())', t || ': admin write', t);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
