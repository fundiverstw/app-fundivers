-- The unified events table and its junctions were created without the standard
-- Supabase role grants that every other public table carries (the renamed
-- reference tables kept theirs through the RENAME). Row access is still gated by
-- RLS — these grants only restore the baseline table-level privileges so the
-- service_role backend key and the anon/authenticated roles reach the tables at
-- all. Mirrors fundive's baseline_schema grants for events / event_* .
GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";

GRANT ALL ON TABLE "public"."event_addons" TO "anon";
GRANT ALL ON TABLE "public"."event_addons" TO "authenticated";
GRANT ALL ON TABLE "public"."event_addons" TO "service_role";

GRANT ALL ON TABLE "public"."event_rooms" TO "anon";
GRANT ALL ON TABLE "public"."event_rooms" TO "authenticated";
GRANT ALL ON TABLE "public"."event_rooms" TO "service_role";

GRANT ALL ON TABLE "public"."event_destinations" TO "anon";
GRANT ALL ON TABLE "public"."event_destinations" TO "authenticated";
GRANT ALL ON TABLE "public"."event_destinations" TO "service_role";
