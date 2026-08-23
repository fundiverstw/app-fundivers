-- Who settled this credit?
--
-- `credits` recorded who ISSUED a credit (created_by) but not who closed it,
-- and closing one is the bigger decision: it says the diver's money has been
-- dealt with. Four different paths settle a credit -- an admin clicking Settle,
-- the apply-credit RPC consuming rows oldest-first, the restore-reclaim
-- trigger, and a repair migration -- so asking each caller to pass a name
-- would leave three of them writing nulls forever.
--
-- A BEFORE trigger stamps it instead, from the one thing every path shares:
-- the session's auth.uid(). Callers cannot forge it (the trigger overwrites
-- whatever was sent), and a settle from a migration or the service role, where
-- auth.uid() is null, falls back to any value the caller did supply rather
-- than blanking a deliberate attribution.
--
-- Reopening a credit clears the stamp: a credit that is open again was not
-- settled by anyone.

ALTER TABLE "public"."credits"
  ADD COLUMN IF NOT EXISTS "settled_by" "uuid" REFERENCES "public"."profiles"("id") ON DELETE SET NULL;

COMMENT ON COLUMN "public"."credits"."settled_by" IS
  'The admin whose session closed this credit. Stamped by trg_credits_stamp_settled_by; never written by callers. Null on credits settled before 20260823110000, and on settles from a migration or the service role.';

CREATE OR REPLACE FUNCTION "public"."credits_stamp_settled_by"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status = 'settled' and old.status is distinct from 'settled' then
    new.settled_by := coalesce(auth.uid(), new.settled_by);
  elsif new.status <> 'settled' then
    new.settled_by := null;
  else
    -- Still settled: the stamp is a record of a past act, not a live field.
    new.settled_by := old.settled_by;
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."credits_stamp_settled_by"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "trg_credits_stamp_settled_by" ON "public"."credits";

CREATE TRIGGER "trg_credits_stamp_settled_by"
  BEFORE UPDATE ON "public"."credits"
  FOR EACH ROW EXECUTE FUNCTION "public"."credits_stamp_settled_by"();
