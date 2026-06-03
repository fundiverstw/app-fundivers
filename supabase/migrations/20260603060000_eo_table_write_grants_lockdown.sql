-- H8 — revoke INSERT/UPDATE/DELETE/TRUNCATE on the EO_* tables from
-- anon and authenticated at the DDL layer; re-grant only the rights
-- that the admin RLS policies actually need.
--
-- Background. The Bubble import in 20260421130941_remote_schema.sql
-- handed the full mutation set to both `anon` and `authenticated` on
-- the catalog tables (EO_courses, EO_dives, EO_prices, EO_rooms,
-- Other_Addons). RLS is the only gate today, and the policies are
-- admin-only — so this isn't exploitable now. The risk is drift: a
-- single `USING (true)` policy slip, or a dashboard click that
-- toggles RLS off on one of these tables (which the codebase has
-- explicitly noted as a thing that has happened before), and the
-- entire catalog becomes world-writable in one keystroke.
--
-- Defence-in-depth: take the underlying grant away. Anon keeps SELECT
-- so the public site / wix-sync reads still work. Authenticated keeps
-- INSERT/UPDATE/DELETE so the admin RLS policies still permit admin
-- writes; the RLS gate is what decides which authenticated users (only
-- those passing is_admin()) actually get a row through. Nobody outside
-- service_role can TRUNCATE.

begin;

revoke insert, update, delete, truncate
  on public."EO_dives",
     public."EO_courses",
     public."EO_prices",
     public."EO_rooms",
     public."Other_Addons"
  from anon, authenticated;

grant insert, update, delete
  on public."EO_dives",
     public."EO_courses",
     public."EO_prices",
     public."EO_rooms",
     public."Other_Addons"
  to authenticated;

commit;
