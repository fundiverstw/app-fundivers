-- seed.sql is a data dump in production's shape: its profiles carry the legacy
-- free-text cert_agency / cert_level and no cert_level_code, because seeds load
-- after the migration that would otherwise have placed them. Run the same
-- backfill production got, so local data looks like production after deploy —
-- including the rows it cannot place.
select * from public.backfill_profile_cert_level_codes();
