-- Production's default privileges are not the ones the squashed baseline
-- declares. The baseline sets `alter default privileges for role postgres in
-- schema public` so a new function is executable by its owner only; the cloud
-- project never received that, and still carries Supabase's stock default of
-- EXECUTE for anon, authenticated and service_role on every new function. Each
-- function created after the baseline therefore reached production callable by
-- anon over PostgREST, while every local and CI database (built from the
-- baseline) showed it locked. Integration tests could not see the gap.
--
-- Eight SECURITY DEFINER functions are affected. Four have no authorization
-- check of their own and are meant for the service role alone:
--   purge_stale_pii          scrubs ID numbers, medical notes, emergency
--                            contacts and card paths for every diver idle past
--                            the cutoff the caller chooses
--   normalize_profile_values rewrites cert_level and nationality across profiles
--   record_signup_attempt    writes the signup rate-limit ledger
--   log_orphan_auth_user     writes the orphaned-auth-user log
-- Four check is_admin() or auth.uid() themselves, and lose anon as defense in
-- depth: admin_delete_user, apply_credit_to_booking, accept_waitlist_offer,
-- create_course_continuation.
--
-- Last, the default privileges are set to what the baseline intended, so the
-- next function or table a migration creates starts locked on production too.

revoke all on function public.purge_stale_pii(integer) from public, anon, authenticated;
grant execute on function public.purge_stale_pii(integer) to service_role;

revoke all on function public.normalize_profile_values() from public, anon, authenticated;
grant execute on function public.normalize_profile_values() to service_role;

revoke all on function public.record_signup_attempt(bytea) from public, anon, authenticated;
grant execute on function public.record_signup_attempt(bytea) to service_role;

revoke all on function public.log_orphan_auth_user(uuid, text, text) from public, anon, authenticated;
grant execute on function public.log_orphan_auth_user(uuid, text, text) to service_role;

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;

revoke all on function public.apply_credit_to_booking(uuid, numeric) from public, anon;
grant execute on function public.apply_credit_to_booking(uuid, numeric) to authenticated;

revoke all on function public.accept_waitlist_offer(uuid) from public, anon;
grant execute on function public.accept_waitlist_offer(uuid) to authenticated;

revoke all on function public.create_course_continuation(uuid, uuid, date[], date[], text) from public, anon;
grant execute on function public.create_course_continuation(uuid, uuid, date[], date[], text) to authenticated;

alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant references, trigger, truncate, maintain on tables to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant update on sequences to anon, authenticated, service_role;
