drop extension if exists "pg_net";


  create table "public"."EO_courses" (
    "course_title" text,
    "title" text,
    "_id" text not null,
    "link-eo-courses-course_title" text,
    "Created Date" timestamp with time zone,
    "price" text,
    "Updated Date" timestamp with time zone,
    "start_date" text,
    "special_date" text,
    "end_date" text,
    "start_time" text,
    "course_name" text,
    "featured_image" text,
    "URL" text,
    "prereqs" text,
    "req_dives" text,
    "included" text,
    "schedule" text,
    "dive_days" bigint,
    "other_addons" text,
    "google_calendar_event_id" text,
    "Owner" text,
    "starting_at" integer
      );



  create table "public"."EO_dives" (
    "dive_title" text not null,
    "title" text,
    "DiveTravel_reference" text,
    "price" text,
    "destination_reference" text,
    "start_date" text,
    "time" text,
    "end_date" text,
    "cancel_date" text,
    "featured" boolean,
    "featured_image" text,
    "second_image" text,
    "link-eo-dives-dive_title" text,
    "_id" text not null,
    "notes" text not null,
    "fully_booked" boolean,
    "prereqs" text,
    "nitrox_required" text,
    "req_dives" bigint,
    "gear_rental" text,
    "cancel_policy" text,
    "room_types" text,
    "has_rooms" boolean,
    "hasotheraddons" boolean,
    "other_addons" text,
    "dive_days" bigint,
    "google_calendar_event_id" text,
    "Created Date" timestamp with time zone,
    "Updated Date" timestamp with time zone,
    "Owner" text,
    "EO_price_reference" text
      );



  create table "public"."EO_prices" (
    "title" text not null,
    "price" text,
    "starting_at" bigint,
    "deposit_amount" bigint,
    "room_options" text,
    "transport" text,
    "_id" text not null,
    "Created Date" timestamp with time zone,
    "Updated Date" timestamp with time zone,
    "Owner" text,
    "EO_dives_price" text
      );



  create table "public"."EO_rooms" (
    "title" text,
    "display_name" text,
    "added_price" bigint,
    "added_price_display" text,
    "per_night" text,
    "EO_prices_room_options" jsonb,
    "_id" text not null,
    "Created Date" timestamp with time zone,
    "Updated Date" timestamp with time zone,
    "Owner" text,
    "EO_dives_room_types" jsonb,
    "currency" text
      );



  create table "public"."Other_Addons" (
    "title" text,
    "price" bigint,
    "display_name" text,
    "currency" text,
    "EO_dives_other_addons" text,
    "EO_courses_other_addons" text,
    "_id" text not null,
    "Created Date" timestamp with time zone,
    "Updated Date" timestamp with time zone,
    "Owner" text
      );


alter table "public"."activities" disable row level security;

alter table "public"."bookings" disable row level security;

alter table "public"."payments" disable row level security;

alter table "public"."profiles" disable row level security;

CREATE UNIQUE INDEX "EO_courses_pkey" ON public."EO_courses" USING btree (_id);

CREATE UNIQUE INDEX "EO_dives_pkey" ON public."EO_dives" USING btree (_id);

CREATE UNIQUE INDEX "EO_prices_pkey" ON public."EO_prices" USING btree (_id);

CREATE UNIQUE INDEX "EO_rooms_pkey" ON public."EO_rooms" USING btree (_id);

CREATE UNIQUE INDEX "Other_Addons_pkey" ON public."Other_Addons" USING btree (_id);

alter table "public"."EO_courses" add constraint "EO_courses_pkey" PRIMARY KEY using index "EO_courses_pkey";

alter table "public"."EO_dives" add constraint "EO_dives_pkey" PRIMARY KEY using index "EO_dives_pkey";

alter table "public"."EO_prices" add constraint "EO_prices_pkey" PRIMARY KEY using index "EO_prices_pkey";

alter table "public"."EO_rooms" add constraint "EO_rooms_pkey" PRIMARY KEY using index "EO_rooms_pkey";

alter table "public"."Other_Addons" add constraint "Other_Addons_pkey" PRIMARY KEY using index "Other_Addons_pkey";

alter table "public"."EO_courses" add constraint "EO_courses_price_fkey" FOREIGN KEY (price) REFERENCES public."EO_prices"(_id) not valid;

alter table "public"."EO_courses" validate constraint "EO_courses_price_fkey";

alter table "public"."EO_dives" add constraint "EO_dives_EO_price_reference_fkey" FOREIGN KEY ("EO_price_reference") REFERENCES public."EO_prices"(_id) ON UPDATE CASCADE ON DELETE SET NULL not valid;

alter table "public"."EO_dives" validate constraint "EO_dives_EO_price_reference_fkey";

alter table "public"."EO_dives" add constraint "EO_dives_price_fkey" FOREIGN KEY (price) REFERENCES public."EO_prices"(_id) ON UPDATE CASCADE ON DELETE SET NULL not valid;

alter table "public"."EO_dives" validate constraint "EO_dives_price_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

grant delete on table "public"."EO_courses" to "anon";

grant insert on table "public"."EO_courses" to "anon";

grant references on table "public"."EO_courses" to "anon";

grant select on table "public"."EO_courses" to "anon";

grant trigger on table "public"."EO_courses" to "anon";

grant truncate on table "public"."EO_courses" to "anon";

grant update on table "public"."EO_courses" to "anon";

grant delete on table "public"."EO_courses" to "authenticated";

grant insert on table "public"."EO_courses" to "authenticated";

grant references on table "public"."EO_courses" to "authenticated";

grant select on table "public"."EO_courses" to "authenticated";

grant trigger on table "public"."EO_courses" to "authenticated";

grant truncate on table "public"."EO_courses" to "authenticated";

grant update on table "public"."EO_courses" to "authenticated";

grant delete on table "public"."EO_courses" to "service_role";

grant insert on table "public"."EO_courses" to "service_role";

grant references on table "public"."EO_courses" to "service_role";

grant select on table "public"."EO_courses" to "service_role";

grant trigger on table "public"."EO_courses" to "service_role";

grant truncate on table "public"."EO_courses" to "service_role";

grant update on table "public"."EO_courses" to "service_role";

grant delete on table "public"."EO_dives" to "anon";

grant insert on table "public"."EO_dives" to "anon";

grant references on table "public"."EO_dives" to "anon";

grant select on table "public"."EO_dives" to "anon";

grant trigger on table "public"."EO_dives" to "anon";

grant truncate on table "public"."EO_dives" to "anon";

grant update on table "public"."EO_dives" to "anon";

grant delete on table "public"."EO_dives" to "authenticated";

grant insert on table "public"."EO_dives" to "authenticated";

grant references on table "public"."EO_dives" to "authenticated";

grant select on table "public"."EO_dives" to "authenticated";

grant trigger on table "public"."EO_dives" to "authenticated";

grant truncate on table "public"."EO_dives" to "authenticated";

grant update on table "public"."EO_dives" to "authenticated";

grant delete on table "public"."EO_dives" to "service_role";

grant insert on table "public"."EO_dives" to "service_role";

grant references on table "public"."EO_dives" to "service_role";

grant select on table "public"."EO_dives" to "service_role";

grant trigger on table "public"."EO_dives" to "service_role";

grant truncate on table "public"."EO_dives" to "service_role";

grant update on table "public"."EO_dives" to "service_role";

grant delete on table "public"."EO_prices" to "anon";

grant insert on table "public"."EO_prices" to "anon";

grant references on table "public"."EO_prices" to "anon";

grant select on table "public"."EO_prices" to "anon";

grant trigger on table "public"."EO_prices" to "anon";

grant truncate on table "public"."EO_prices" to "anon";

grant update on table "public"."EO_prices" to "anon";

grant delete on table "public"."EO_prices" to "authenticated";

grant insert on table "public"."EO_prices" to "authenticated";

grant references on table "public"."EO_prices" to "authenticated";

grant select on table "public"."EO_prices" to "authenticated";

grant trigger on table "public"."EO_prices" to "authenticated";

grant truncate on table "public"."EO_prices" to "authenticated";

grant update on table "public"."EO_prices" to "authenticated";

grant delete on table "public"."EO_prices" to "service_role";

grant insert on table "public"."EO_prices" to "service_role";

grant references on table "public"."EO_prices" to "service_role";

grant select on table "public"."EO_prices" to "service_role";

grant trigger on table "public"."EO_prices" to "service_role";

grant truncate on table "public"."EO_prices" to "service_role";

grant update on table "public"."EO_prices" to "service_role";

grant delete on table "public"."EO_rooms" to "anon";

grant insert on table "public"."EO_rooms" to "anon";

grant references on table "public"."EO_rooms" to "anon";

grant select on table "public"."EO_rooms" to "anon";

grant trigger on table "public"."EO_rooms" to "anon";

grant truncate on table "public"."EO_rooms" to "anon";

grant update on table "public"."EO_rooms" to "anon";

grant delete on table "public"."EO_rooms" to "authenticated";

grant insert on table "public"."EO_rooms" to "authenticated";

grant references on table "public"."EO_rooms" to "authenticated";

grant select on table "public"."EO_rooms" to "authenticated";

grant trigger on table "public"."EO_rooms" to "authenticated";

grant truncate on table "public"."EO_rooms" to "authenticated";

grant update on table "public"."EO_rooms" to "authenticated";

grant delete on table "public"."EO_rooms" to "service_role";

grant insert on table "public"."EO_rooms" to "service_role";

grant references on table "public"."EO_rooms" to "service_role";

grant select on table "public"."EO_rooms" to "service_role";

grant trigger on table "public"."EO_rooms" to "service_role";

grant truncate on table "public"."EO_rooms" to "service_role";

grant update on table "public"."EO_rooms" to "service_role";

grant delete on table "public"."Other_Addons" to "anon";

grant insert on table "public"."Other_Addons" to "anon";

grant references on table "public"."Other_Addons" to "anon";

grant select on table "public"."Other_Addons" to "anon";

grant trigger on table "public"."Other_Addons" to "anon";

grant truncate on table "public"."Other_Addons" to "anon";

grant update on table "public"."Other_Addons" to "anon";

grant delete on table "public"."Other_Addons" to "authenticated";

grant insert on table "public"."Other_Addons" to "authenticated";

grant references on table "public"."Other_Addons" to "authenticated";

grant select on table "public"."Other_Addons" to "authenticated";

grant trigger on table "public"."Other_Addons" to "authenticated";

grant truncate on table "public"."Other_Addons" to "authenticated";

grant update on table "public"."Other_Addons" to "authenticated";

grant delete on table "public"."Other_Addons" to "service_role";

grant insert on table "public"."Other_Addons" to "service_role";

grant references on table "public"."Other_Addons" to "service_role";

grant select on table "public"."Other_Addons" to "service_role";

grant trigger on table "public"."Other_Addons" to "service_role";

grant truncate on table "public"."Other_Addons" to "service_role";

grant update on table "public"."Other_Addons" to "service_role";


