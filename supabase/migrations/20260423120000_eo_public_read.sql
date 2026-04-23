-- Public-read RLS policies on the catalog tables.
--
-- Context: the Wix marketing site (backend/supabase.jsw) fetches these tables
-- via PostgREST using the anon key to render the public calendar + pricing.
-- Without an explicit `select` policy, RLS blocks those reads and the only
-- workaround has been leaving RLS off on these tables entirely. Since the
-- same rows are already visible to any anonymous visitor of fundiverstw.com,
-- making them anon-readable via RLS is the honest representation — not a
-- loosening of the security posture.
--
-- Writes are NOT granted: no insert/update/delete policy means only the
-- service role (migrations, future Bubble re-import) can mutate. The app's
-- authenticated users can still read (the select policy covers both roles).

begin;

-- Ensure RLS is on. Idempotent on an already-enabled table, and flips it ON
-- together with the select policies below in a single transaction — so if
-- cloud had RLS disabled as the Wix workaround, the switchover doesn't
-- leave any window where reads are blocked.
alter table public."EO_dives"     enable row level security;
alter table public."EO_courses"   enable row level security;
alter table public."EO_prices"    enable row level security;
alter table public."EO_rooms"     enable row level security;
alter table public."Other_Addons" enable row level security;

-- `drop policy if exists` makes this migration drift-tolerant: if the same
-- policy name was ever created manually via the dashboard (or a prior
-- attempt), we don't abort with "policy already exists".
drop policy if exists "EO_dives: public select"     on public."EO_dives";
drop policy if exists "EO_courses: public select"   on public."EO_courses";
drop policy if exists "EO_prices: public select"    on public."EO_prices";
drop policy if exists "EO_rooms: public select"     on public."EO_rooms";
drop policy if exists "Other_Addons: public select" on public."Other_Addons";

create policy "EO_dives: public select"
  on public."EO_dives"     for select to anon, authenticated using (true);

create policy "EO_courses: public select"
  on public."EO_courses"   for select to anon, authenticated using (true);

create policy "EO_prices: public select"
  on public."EO_prices"    for select to anon, authenticated using (true);

create policy "EO_rooms: public select"
  on public."EO_rooms"     for select to anon, authenticated using (true);

create policy "Other_Addons: public select"
  on public."Other_Addons" for select to anon, authenticated using (true);

commit;
