-- Signup is no longer an application.
--
-- Until now handle_new_user left profiles.status at its 'pending' default and
-- RequireActive parked the new diver on /pending until an admin approved them.
-- Divers read that wait as "the site is broken" — they had signed up, agreed to
-- the terms, and still could not see a calendar. The shop was approving
-- essentially everyone anyway, so the queue bought no safety, only churn.
--
-- New accounts are 'active' from the first insert. The column, the
-- profiles_status_check constraint, is_active_user() and every policy built on
-- it stay exactly as they are: an admin can still move a profile to 'pending'
-- or 'rejected' by hand, and doing so still severs booking and
-- push-subscription inserts. What changes is only the starting point.
--
-- The trigger also picks up `name` now. The signup form asks for the name as it
-- appears on the diver's passport (the shop needs it for boat manifests and
-- insurance), and create-account passes it through user_metadata — writing it
-- here means the profile is born with it rather than being patched a moment
-- later by a client the RLS layer would have to trust.
--
-- Everything else here is carried forward unchanged from
-- 20260711100000_shop_authored_terms.sql, and must stay that way — all three
-- are things the client is deliberately not trusted with:
--   * agreed_to_terms_at is server-stamped with now(). The client sends the
--     key to signal that consent happened; the timestamp value is theirs to
--     lie about, so it is ignored (audit L10, non-repudiation).
--   * agreed_to_terms_version is read from public.terms, NOT from the payload.
--     A modified client that named a version above the real one would never be
--     re-prompted by the terms banner again. Whether they consented is a
--     client fact (it is a checkbox); which version they consented to is not.
--     Pinned by tests/integration/terms-consent-versioning.test.ts.
--   * status is not read from metadata at all. It is a server decision.
--     Accepting it from the client would let anyone sign up past a closure
--     with a crafted payload.

CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  consented bool := new.raw_user_meta_data ? 'agreed_to_terms_at';
  live_ver  int;
  full_name text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), '');
begin
  select version into live_ver from public.terms;

  insert into public.profiles (id, email, name, status, agreed_to_terms_at, agreed_to_terms_version)
  values (
    new.id,
    new.email,
    full_name,
    'active',
    case when consented then now() else null end,
    case when consented then coalesce(live_ver, 1) else null end
  );
  return new;
end;
$$;

ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";
