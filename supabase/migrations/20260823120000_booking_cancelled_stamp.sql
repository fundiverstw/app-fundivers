-- When was this booking cancelled, and by whom?
--
-- Nowhere in the schema recorded either. `status` says 'cancelled' and stops
-- there; `refund_requested_at` says when the diver ASKED, which can be days
-- earlier or absent entirely (an admin cancelling a spot, a shop calling off
-- an event). The admin audit log catches some of it, but only some: its
-- trigger skips writes where auth.uid() is null or the actor is not an admin,
-- so a diver cancelling their own booking and every edge-function or
-- service-role cancellation leave no trace at all.
--
-- Two things need this. The accounting views name the person behind each act
-- that touched money, and cancelling a paid booking is one of the largest --
-- it strands whatever the diver paid until someone refunds it, credits it, or
-- keeps it as a fee. And a running balance statement has to reverse a
-- cancelled booking's charge and payments at the point they stopped counting;
-- without a timestamp there is no such point.
--
-- Backfill runs BEFORE the trigger exists, on purpose: the trigger derives
-- these columns from a status TRANSITION, and a backfill UPDATE changes no
-- status, so with the trigger in place every backfilled row would be handed
-- straight back its old null.

ALTER TABLE "public"."bookings"
  ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "cancelled_by" "uuid" REFERENCES "public"."profiles"("id") ON DELETE SET NULL;

COMMENT ON COLUMN "public"."bookings"."cancelled_at" IS
  'When this booking moved to cancelled. Stamped by trg_bookings_stamp_cancellation; never written by callers. Null on cancellations older than 20260823120000 that the admin audit log did not witness.';
COMMENT ON COLUMN "public"."bookings"."cancelled_by" IS
  'Whose session cancelled it -- the diver themselves, or the admin who did it for them. Stamped by trg_bookings_stamp_cancellation.';

-- Recover what the audit log did witness: the most recent logged update that
-- put a booking into 'cancelled'. Most recent, not first, because a booking
-- cancelled, restored and cancelled again is standing on its LATEST
-- cancellation -- and only rows still cancelled today are filled at all.
WITH first_cancel AS (
  SELECT DISTINCT ON ("target_id")
         "target_id"::"uuid" AS "booking_id", "created_at", "actor_id"
    FROM "public"."admin_audit_log"
   WHERE "target_table" = 'bookings'
     AND "action" = 'update'
     AND "after" ->> 'status' = 'cancelled'
     AND "before" ->> 'status' IS DISTINCT FROM 'cancelled'
   ORDER BY "target_id", "created_at" DESC
)
UPDATE "public"."bookings" b
   SET "cancelled_at" = fc."created_at",
       "cancelled_by" = fc."actor_id"
  FROM first_cancel fc
 WHERE b."id" = fc."booking_id"
   AND b."status" = 'cancelled'
   AND b."cancelled_at" IS NULL;

CREATE OR REPLACE FUNCTION "public"."bookings_stamp_cancellation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    -- Derived, never accepted from the caller: a diver cannot post a booking
    -- that claims someone else cancelled it.
    if new.status = 'cancelled' then
      new.cancelled_at := now();
      new.cancelled_by := auth.uid();
    else
      new.cancelled_at := null;
      new.cancelled_by := null;
    end if;
    return new;
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    new.cancelled_at := now();
    new.cancelled_by := auth.uid();
  elsif new.status <> 'cancelled' then
    -- Restored. It is not a cancelled booking any more, and the reclaim
    -- trigger has already put its money back where it belongs.
    new.cancelled_at := null;
    new.cancelled_by := null;
  else
    -- Still cancelled: the stamp records a past act and does not move.
    new.cancelled_at := old.cancelled_at;
    new.cancelled_by := old.cancelled_by;
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."bookings_stamp_cancellation"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "trg_bookings_stamp_cancellation" ON "public"."bookings";

-- Fires on every UPDATE, not just UPDATE OF status: the "still cancelled"
-- branch is what stops an unrelated edit from carrying a forged cancelled_by
-- through, and a column list would skip the trigger entirely for exactly
-- those updates.
CREATE TRIGGER "trg_bookings_stamp_cancellation"
  BEFORE INSERT OR UPDATE ON "public"."bookings"
  FOR EACH ROW EXECUTE FUNCTION "public"."bookings_stamp_cancellation"();
