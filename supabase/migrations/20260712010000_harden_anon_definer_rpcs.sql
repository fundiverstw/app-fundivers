-- Security: two SECURITY DEFINER functions (owner postgres, so they bypass RLS)
-- were granted EXECUTE to `anon` and `authenticated` in the baseline, with no
-- internal auth gate. Because the anon key ships in the public SPA bundle, any
-- external actor could invoke them via /rest/v1/rpc/<name>:
--
--   * offer_next_waitlist_spot(uuid) INSERTs a waitlist_offers row -- firing a
--     real "your spot opened" email to a waitlisted diver and perturbing queue
--     order -- for any event UUID (event UUIDs are publicly readable).
--   * refresh_event_display_title(uuid) UPDATEs events.display_title.
--
-- Neither is meant to be client-callable. Their only legitimate callers are:
--   * a DB trigger (internal `perform`, which ignores EXECUTE grants), and
--   * for offer_next_waitlist_spot, the push cron worker using the service-role
--     key (workers/push/src/index.ts).
--
-- Strip the anon/authenticated (and PUBLIC default) grants; keep service_role.
-- Migrations are immutable once pushed, so this is a new forward revoke rather
-- than an edit to the baseline grants.

revoke all on function public.offer_next_waitlist_spot(uuid) from public, anon, authenticated;
grant execute on function public.offer_next_waitlist_spot(uuid) to service_role;

revoke all on function public.refresh_event_display_title(uuid) from public, anon, authenticated;
grant execute on function public.refresh_event_display_title(uuid) to service_role;
