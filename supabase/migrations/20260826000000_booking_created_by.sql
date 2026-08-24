-- Who put this diver on this event?
--
-- Nothing recorded it. A registration made by an admin through Add diver and
-- one a diver made themselves at 2am produced identical rows, so the only way
-- to tell them apart was to remember. That matters at the desk: "I never signed
-- up for this" and "you asked me to book you in" are the same conversation, and
-- the booking said nothing either way.
--
-- Stamped, never accepted from the caller, for the same reason cancelled_by is
-- (20260823120000): a value a diver can write is a value a diver can dispute.
-- The three insert paths need three different answers, though, because only one
-- of them runs as the person doing it:
--
--   authenticated (PostgREST)   the session IS the actor -> force auth.uid(),
--                               ignoring whatever was sent
--   security definer RPC        current_user is the owner, but the JWT claim
--                               survives -> fall back to auth.uid()
--   service_role (edge fn)      auth.uid() is null; create-registration has
--                               already verified the Bearer token and resolved
--                               the caller, so its explicit value is trusted
--
-- A course continuation is the exception to all three: it is the same
-- registration on a second event row, so it inherits the origin of the booking
-- it continues instead of naming the admin who split it.
--
-- Null means nobody knows: every booking predating this, and the guest path,
-- where the person registering had no account until the request that made it.
-- Read created_by = user_id as "registered themselves".

ALTER TABLE "public"."bookings"
  ADD COLUMN IF NOT EXISTS "created_by" "uuid";

ALTER TABLE "public"."bookings"
  DROP CONSTRAINT IF EXISTS "bookings_created_by_fkey";

-- SET NULL, matching cancelled_by / payer_id / admin_audit_log.actor_id: a
-- deleted profile must not pin somebody else's booking in place. bookings.user_id
-- cascades, so a deletion takes that person's own bookings with it, but the ones
-- they created FOR OTHERS outlive them and keep an honest blank instead.
ALTER TABLE "public"."bookings"
  ADD CONSTRAINT "bookings_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;

COMMENT ON COLUMN "public"."bookings"."created_by" IS
  'Who created this booking. Stamped by trg_bookings_stamp_created_by; never written by callers except create-registration, which runs as service_role after verifying the Bearer token. Equal to user_id when the diver registered themselves; null on the guest path and on bookings predating 20260826000000.';


-- What little history can be recovered. audit_admin_write logs an insert only
-- when an ADMIN wrote the row directly through PostgREST, so this catches the
-- admin-made bookings and nothing else -- the edge function inserts as
-- service_role, where auth.uid() is null and the audit trigger returns early.
-- Everything it cannot name keeps an honest blank rather than a guess.
WITH first_insert AS (
  SELECT DISTINCT ON ("target_id")
         "target_id"::"uuid" AS "booking_id", "actor_id"
    FROM "public"."admin_audit_log"
   WHERE "target_table" = 'bookings'
     AND "action" = 'insert'
     AND "actor_id" IS NOT NULL
   ORDER BY "target_id", "created_at" ASC
)
UPDATE "public"."bookings" b
   SET "created_by" = fi."actor_id"
  FROM first_insert fi
 WHERE b."id" = fi."booking_id"
   AND b."created_by" IS NULL;


CREATE OR REPLACE FUNCTION "public"."bookings_stamp_created_by"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_continues text;
begin
  if tg_op = 'INSERT' then
    -- SECURITY INVOKER on purpose: current_user has to reflect the real caller.
    -- 'authenticated' is a diver or admin posting straight to PostgREST, where
    -- the session is the actor and anything they sent is a claim about
    -- themselves that we overwrite.
    if current_user = 'authenticated' then
      new.created_by := auth.uid();
      return new;
    end if;

    -- A course continuation is the same registration split across two event
    -- rows, so it inherits its origin rather than naming the admin who did the
    -- splitting. Without this, a diver who signed themselves up for a course
    -- reads as "Added by <admin>" on the half they finish it in -- true of the
    -- row, false about the registration.
    --
    -- Reachable only from the definer RPC that writes this column
    -- (create_course_continuation, admin-gated) because the authenticated
    -- branch above returns first: a diver who forged continues_booking_id to
    -- inherit somebody else's origin still gets stamped as themselves.
    --
    -- Read through to_jsonb rather than as new.continues_booking_id, because
    -- course continuations are a feature FunDive has not taken yet and plpgsql
    -- resolves a field reference at execution time -- a direct one would raise
    -- on every booking insert wherever the column is absent. This reads as null
    -- there, and starts working by itself if the column ever arrives.
    v_continues := to_jsonb(new) ->> 'continues_booking_id';
    if v_continues is not null then
      select b.created_by into new.created_by
        from public.bookings b where b.id = v_continues::uuid;
      return new;
    end if;

    new.created_by := coalesce(new.created_by, auth.uid());
    return new;
  end if;

  -- Who made a booking is a fact about the past. Editing the row never moves
  -- it, and no UPDATE may set it on a row that was created without one.
  new.created_by := old.created_by;
  return new;
end;
$$;

ALTER FUNCTION "public"."bookings_stamp_created_by"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "trg_bookings_stamp_created_by" ON "public"."bookings";

-- Every UPDATE, not just a column list: the "does not move" branch is what
-- stops an unrelated edit from carrying a forged created_by through, and a
-- column list would skip the trigger entirely for exactly those updates.
CREATE TRIGGER "trg_bookings_stamp_created_by"
  BEFORE INSERT OR UPDATE ON "public"."bookings"
  FOR EACH ROW EXECUTE FUNCTION "public"."bookings_stamp_created_by"();
