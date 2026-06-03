-- H3 — pin search_path on the three remaining SECURITY DEFINER
-- functions that were missing it.
--
-- Background. A `SECURITY DEFINER` function in Postgres executes as
-- the function owner (postgres-equivalent on Supabase) but resolves
-- unqualified identifiers via the CALLER's search_path. An attacker
-- who can create a session-local object — temp schema, pg_temp,
-- non-public schema, even a shadow of a builtin — can shim a name
-- the definer relies on (`profiles`, `now()`, `coalesce()`, etc.) and
-- have the definer use it with elevated rights.
--
-- The fix is mechanical: `ALTER FUNCTION ... SET search_path = public`
-- so the definer always resolves to the production schema regardless
-- of the caller's settings. Same defence the audit-log trigger,
-- handle_new_user, purge_stale_pii and friends already have.
--
-- Three remaining functions (handle_new_user was fixed during the L10
-- work in 20260603000000_terms_consent_versioning.sql):
--
--   * accept_waitlist_offer(uuid) — diver claims a waitlist offer.
--     Reads + writes waitlist_offers and bookings.
--   * handle_booking_cancellation() — trigger on bookings UPDATE.
--     Cascades to waitlist_offers and re-shuffles the queue.
--   * offer_next_waitlist_spot(uuid, text) — promotes the next
--     waitlist entry when a slot opens. Service-role + cron callers.

begin;

alter function public.accept_waitlist_offer(uuid)
  set search_path = public;

alter function public.handle_booking_cancellation()
  set search_path = public;

alter function public.offer_next_waitlist_spot(uuid, text)
  set search_path = public;

commit;
