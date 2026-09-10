-- Local-only: strip the WIX sync triggers off the local DB.
--
-- The migrations install AFTER INSERT/UPDATE/DELETE wix_sync_* triggers on
-- the reference tables (after the events unification these live on the
-- RENAMED tables: public.prices, public.rooms, public.addons,
-- public.trip_templates). Each one calls supabase_functions.http_request()
-- against the LIVE production WIX webhook
-- (https://fundiverstw.com/_functions/supabaseWebhook), because that's where
-- they were originally defined and how they got captured by `supabase pull`.
--
-- Migrations apply to local AND cloud, so without this file the local DB
-- ships every integration-test write to production WIX. We saw "Test
-- Course", "Cancellation test dive", and other helper-fixture rows
-- appearing on the WIX side while never landing in cloud Supabase --
-- that was local triggers POSTing to a hardcoded prod URL.
--
-- This file is listed in [db.seed].sql_paths (config.toml) so it runs
-- after migrations on every `make reset`. Migrations are immutable once
-- pushed, so we can't delete the triggers from the
-- migration -- we drop them locally on every reset instead. Cloud keeps
-- the triggers; local does not. The wix_sync_notify() function is kept.

drop trigger if exists wix_sync_trip_templates on public.trip_templates;
drop trigger if exists wix_sync_eo_prices    on public.prices;
drop trigger if exists wix_sync_eo_rooms     on public.rooms;
drop trigger if exists wix_sync_other_addons on public.addons;
drop trigger if exists wix_sync_event_rooms        on public.event_rooms;
drop trigger if exists wix_sync_event_addons       on public.event_addons;
drop trigger if exists wix_sync_event_destinations on public.event_destinations;
drop trigger if exists wix_sync_events              on public.events;
drop trigger if exists wix_sync_travel_destinations on public.travel_destinations;
