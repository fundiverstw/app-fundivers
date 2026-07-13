-- A diver may create a booking only in a queue state (pending/waitlisted) and,
-- once it exists, may only cancel it. The RLS self-insert / self-update
-- policies gate the *row* (auth.uid() = user_id) but not the *columns*, so
-- without this guard a diver could PATCH their own booking to status=confirmed
-- (self-confirm without paying, jump the waitlist) or INSERT one already
-- confirmed with a zero total. Every privileged transition happens through a
-- SECURITY DEFINER RPC or the service role, so we can trust anything whose
-- effective role is not the plain end-user 'authenticated' role.

CREATE OR REPLACE FUNCTION "public"."bookings_guard_diver_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  -- SECURITY DEFINER RPCs run as their owner (accept_waitlist_offer promotes
  -- waitlisted -> pending; apply_credit_to_booking promotes pending ->
  -- confirmed at the deposit threshold), and migrations / edge functions /
  -- push workers run as postgres or service_role. Only a direct PostgREST call
  -- from a diver runs as 'authenticated'. This function is SECURITY INVOKER on
  -- purpose so current_user reflects that real context.
  if current_user <> 'authenticated' then
    return new;
  end if;

  -- Staff acting through the app hold an authenticated session too, so gate
  -- them by role, not by current_user.
  if public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('pending', 'waitlisted') then
      raise exception 'a booking can only be created as pending or waitlisted'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status and new.status <> 'cancelled' then
    raise exception 'divers may only cancel a booking; other status changes are staff-only'
      using errcode = 'check_violation';
  end if;

  -- Capacity is only re-checked on INSERT, so a diver must not re-home a
  -- booking onto a different (possibly full) event.
  if new.event_id is distinct from old.event_id then
    raise exception 'a booking cannot be moved to a different event'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

ALTER FUNCTION "public"."bookings_guard_diver_status"() OWNER TO "postgres";

CREATE TRIGGER "trg_bookings_guard_diver_status"
  BEFORE INSERT OR UPDATE OF "status", "event_id" ON "public"."bookings"
  FOR EACH ROW EXECUTE FUNCTION "public"."bookings_guard_diver_status"();
