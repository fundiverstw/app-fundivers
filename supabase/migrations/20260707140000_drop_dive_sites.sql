-- dive_sites was an app-only Bubble-era dive-site catalog with no fundive
-- counterpart and no reader (no app code, no FK/column reference, no view, not
-- Wix-synced). Dropped to reach schema-identity with fundive (user decision).
begin;
drop table if exists public.dive_sites cascade;
commit;
notify pgrst, 'reload schema';
