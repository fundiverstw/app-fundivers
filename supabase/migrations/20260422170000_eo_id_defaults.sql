-- Give _id a default on all Bubble-imported EO tables so rows created via
-- the Supabase GUI (or any insert that omits _id) get a unique identifier
-- automatically. _id remains the PRIMARY KEY on each table, so uniqueness
-- + NOT NULL are still enforced.
alter table "public"."EO_dives"
  alter column "_id" set default gen_random_uuid()::text;

alter table "public"."EO_courses"
  alter column "_id" set default gen_random_uuid()::text;

alter table "public"."EO_prices"
  alter column "_id" set default gen_random_uuid()::text;

alter table "public"."EO_rooms"
  alter column "_id" set default gen_random_uuid()::text;

alter table "public"."Other_Addons"
  alter column "_id" set default gen_random_uuid()::text;
