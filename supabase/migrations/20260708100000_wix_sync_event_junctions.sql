-- Extend the Wix reference-data sync to the event<->catalog junction tables so
-- that changing an event's rooms / add-ons / destinations propagates to the Wix
-- collections the same way the catalog tables already do. Reuses the existing
-- public.wix_sync_notify() (POSTs the changed row to the Wix webhook, skipping
-- when the vault 'wix_sync_token' secret is absent -- i.e. no-ops locally).
create or replace trigger wix_sync_event_rooms
  after insert or delete or update on public.event_rooms
  for each row execute function public.wix_sync_notify();

create or replace trigger wix_sync_event_addons
  after insert or delete or update on public.event_addons
  for each row execute function public.wix_sync_notify();

create or replace trigger wix_sync_event_destinations
  after insert or delete or update on public.event_destinations
  for each row execute function public.wix_sync_notify();
