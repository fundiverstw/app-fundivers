-- A partner ticked "Active (shown to divers)" should be shown to divers.
--
-- It wasn't, unless the shop also happened to hold an email address for it.
-- list_trusted_partners() filtered on `contact_email is not null` on the theory
-- that a partner you can't message is a partner not worth listing, so the
-- Trusted Partners tab quietly omitted every partner the admin had marked
-- viewable and never entered an address for — with nothing on the admin screen
-- to say so. The checkbox promised one thing and the RPC did another.
--
-- The listing is the vouch; messaging is the extra on top of it. A diver headed
-- to Raja Ampat is served by knowing which shop there we stand behind, whether
-- or not the introduction can be brokered through us — the website is right
-- there. So every active partner is listed now, and `contactable` carries what
-- the filter used to decide silently: true when the shop holds an address the
-- contact-trusted-partner edge function can reach, letting the diver view offer
-- the Message button only where it will work.
--
-- The email itself still never leaves the server — contactable is a boolean
-- about one, not the one. Return type changes, so the function is dropped and
-- recreated rather than replaced.

DROP FUNCTION IF EXISTS "public"."list_trusted_partners"();

CREATE OR REPLACE FUNCTION "public"."list_trusted_partners"()
RETURNS TABLE("id" "uuid", "name" "text", "region" "text", "blurb" "text", "website" "text", "contactable" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select id, name, coalesce(location, country) as region, vouch_notes as blurb, website,
         contact_email is not null as contactable
  from public.trusted_partners
  where active
  order by name
$$;

ALTER FUNCTION "public"."list_trusted_partners"() OWNER TO "postgres";

GRANT ALL ON FUNCTION "public"."list_trusted_partners"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_trusted_partners"() TO "anon";
GRANT ALL ON FUNCTION "public"."list_trusted_partners"() TO "service_role";
