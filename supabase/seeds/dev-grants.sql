-- Local-only: restore the standard Supabase role grants on public tables.
--
-- app-fundivers' migrations grant anon/authenticated/service_role explicitly on
-- only a handful of tables (the EO_* legacy tables + the converged events/prices
-- /rooms/addons/event_* set); every other table historically relied on Supabase
-- default privileges. On a fresh local `supabase db reset` those defaults only
-- hand out TRUNCATE/REFERENCES/TRIGGER — not SELECT/INSERT/UPDATE/DELETE — so
-- PostgREST calls as service_role/authenticated hit "permission denied for
-- table ...". That breaks the integration harness (createTestUser writes
-- profiles as service_role) and cascades into most integration suites.
--
-- Row-level access stays governed by RLS; these are just the table/sequence
-- grants prod already has. Tables/sequences only — function EXECUTE grants are
-- set deliberately by the migrations (some are revoked from anon on purpose),
-- so we don't touch routines here.
--
-- Dev-only: seed files are never pushed to cloud (`make push` ships migrations
-- only). Runs on every `make reset` via config.toml's [db.seed] sql_paths.

-- Base tables only (relkind = 'r'). GRANT ... ON ALL TABLES would also hit the
-- EO_* compat views, handing anon DELETE/UPDATE on them and defeating the
-- read-only contract those views encode (their SELECT-for-anon grant already
-- comes from the compat-views migration).
grant usage on schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format(
      'grant all on table public.%I to anon, authenticated, service_role',
      r.relname
    );
  end loop;
end$$;
