-- Retire the Wix sync.
--
-- fundiverstw.com moved off Wix to the Cloudflare-hosted site-fundivers, which
-- reads the catalog and events straight from this database: its event pages
-- (/events/<id>, the address the "share this event" button links to) are drawn
-- from `events` when they are opened. Nothing needs pushing anywhere.
--
-- The triggers below POSTed every change to https://fundiverstw.com/
-- _functions/supabaseWebhook, the Wix site's webhook. That hostname now serves
-- the new site, which has no such endpoint, so every edit would make a failed
-- outbound request. Drop them, and the functions that sent the POSTs.
--
-- Apply this when fundiverstw.com is switched to the new site, not before:
-- until then Wix still serves the public pages and needs the sync.

drop trigger if exists wix_sync_cancellation_policies on public.cancellation_policies;
drop trigger if exists wix_sync_cert_levels           on public.cert_levels;
drop trigger if exists wix_sync_eo_prices             on public.prices;
drop trigger if exists wix_sync_eo_rooms              on public.rooms;
drop trigger if exists wix_sync_other_addons          on public.addons;
drop trigger if exists wix_sync_trip_templates        on public.trip_templates;
drop trigger if exists wix_sync_event_rooms           on public.event_rooms;
drop trigger if exists wix_sync_event_addons          on public.event_addons;
drop trigger if exists wix_sync_event_destinations    on public.event_destinations;
drop trigger if exists wix_sync_events                on public.events;
drop trigger if exists wix_sync_travel_destinations   on public.travel_destinations;

drop function if exists public.wix_sync_all(text);
drop function if exists public.wix_sync_notify();

-- The vault secret 'wix_sync_token' is left in place: deleting a vault secret
-- is not something a migration should do silently. Remove it from the Supabase
-- dashboard (Vault) once the switch is done.
