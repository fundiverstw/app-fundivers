-- Local-only: strip the WIX sync triggers off the local DB.
--
-- supabase/migrations/20260430153210_remote_schema.sql installs eight
-- AFTER INSERT/UPDATE/DELETE triggers on public.EO_*, public.DiveTravel,
-- public.Other_Addons, public.cancellation_policies, public.cert_levels.
-- Each one calls supabase_functions.http_request() against the LIVE
-- production WIX webhook (https://fundiverstw.com/_functions/supabaseWebhook),
-- because that's where they were originally defined and how they got
-- captured by `supabase pull`.
--
-- Migrations apply to local AND cloud, so without this file the local DB
-- ships every integration-test write to production WIX. We saw "Test
-- Course", "Cancellation test dive", and other helper-fixture rows
-- appearing on the WIX side while never landing in cloud Supabase --
-- that was local triggers POSTing to a hardcoded prod URL.
--
-- This file is listed in [db.seed].sql_paths (config.toml) so it runs
-- after migrations on every `make reset`. Migrations are immutable once
-- pushed (CLAUDE.md rule #1), so we can't delete the triggers from the
-- migration -- we drop them locally on every reset instead. Cloud keeps
-- the triggers; local does not.

drop trigger if exists wix_sync_dive_travel           on public."DiveTravel";
drop trigger if exists wix_sync_eo_courses            on public."EO_courses";
drop trigger if exists wix_sync_eo_dives              on public."EO_dives";
drop trigger if exists wix_sync_eo_prices             on public."EO_prices";
drop trigger if exists wix_sync_eo_rooms              on public."EO_rooms";
drop trigger if exists wix_sync_other_addons          on public."Other_Addons";
drop trigger if exists wix_sync_cancellation_policies on public.cancellation_policies;
drop trigger if exists wix_sync_cert_levels           on public.cert_levels;
