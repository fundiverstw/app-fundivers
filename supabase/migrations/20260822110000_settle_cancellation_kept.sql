-- Let an admin say "the shop keeps this" and have the holding list believe them.
--
-- /admin/refunds lists every cancelled booking whose net paid is still
-- positive and which carries no credit saying the money was returned. Two
-- endings clear a row, and both work by recording something: a 'refunded'
-- payment, or a returned credit.
--
-- Real life has a third ending. A diver paid 3000, cancelled late, and the
-- shop's policy keeps 500 of it. The admin refunds 2500, the remaining 500 is
-- legitimately shop revenue for that event -- and the booking sits on the list
-- forever, because the query cannot tell "kept as a cancellation fee" from
-- "nobody has dealt with this yet". Nothing is wrong with the money; the list
-- simply has no way to be told.
--
-- That matters more than it looks. The list is only worth checking because an
-- empty list means everything is handled. Rows that can never be cleared
-- accumulate every season until nobody reads it -- which is how the problem it
-- exists to catch (money stranded on a cancelled booking) comes back.
--
-- So: an explicit acknowledgement stamped on the booking. It moves no money,
-- because the money is already right. It records who decided, when, and how
-- much was kept.

ALTER TABLE "public"."bookings"
  ADD COLUMN IF NOT EXISTS "cancellation_settled_at"   timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "cancellation_settled_by"   "uuid",
  ADD COLUMN IF NOT EXISTS "cancellation_settled_note" "text";

ALTER TABLE "public"."bookings"
  DROP CONSTRAINT IF EXISTS "bookings_cancellation_settled_by_fkey";

ALTER TABLE "public"."bookings"
  ADD CONSTRAINT "bookings_cancellation_settled_by_fkey"
  FOREIGN KEY ("cancellation_settled_by") REFERENCES "public"."profiles"("id");

-- The holding list scans cancelled bookings; this keeps the acknowledged ones
-- cheap to skip.
CREATE INDEX IF NOT EXISTS "bookings_cancellation_unsettled_idx"
  ON "public"."bookings" USING "btree" ("status")
  WHERE ("status" = 'cancelled' AND "cancellation_settled_at" IS NULL);


-- A diver must not be able to stamp their own booking as settled: that would
-- hide money the shop still owes them from the only surface that shows it.
--
-- The guard trigger fired on UPDATE OF (status, event_id) only, so these new
-- columns would have slipped past it entirely -- the "bookings: self update"
-- RLS policy gates the ROW, never the columns. Both the trigger's column list
-- and its body have to grow together; adding the check without re-creating the
-- trigger would be a silent no-op.
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
    if new.cancellation_settled_at is not null
       or new.cancellation_settled_by is not null
       or new.cancellation_settled_note is not null then
      raise exception 'settling a cancellation is staff-only'
        using errcode = 'insufficient_privilege';
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

  -- Acknowledging that the shop keeps a cancelled booking's money is an admin
  -- decision. A diver marking their own booking settled would erase it from
  -- the holding list while the shop still held their cash.
  if new.cancellation_settled_at   is distinct from old.cancellation_settled_at
     or new.cancellation_settled_by   is distinct from old.cancellation_settled_by
     or new.cancellation_settled_note is distinct from old.cancellation_settled_note then
    raise exception 'settling a cancellation is staff-only'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

DROP TRIGGER IF EXISTS "trg_bookings_guard_diver_status" ON "public"."bookings";

CREATE TRIGGER "trg_bookings_guard_diver_status"
  BEFORE INSERT OR UPDATE OF
    "status", "event_id",
    "cancellation_settled_at", "cancellation_settled_by", "cancellation_settled_note"
  ON "public"."bookings"
  FOR EACH ROW EXECUTE FUNCTION "public"."bookings_guard_diver_status"();
