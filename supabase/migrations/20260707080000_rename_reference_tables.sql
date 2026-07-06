-- Converge (4/7): rename the reference/catalog tables to fundive's names and
-- align their key columns. EO_prices/EO_rooms/Other_Addons already hold uuid
-- _id values, so those are a straight table + column rename. DiveTravel /
-- TravelDestinations / cancellation_policies also hold uuid-shaped text _ids
-- (verified on the live dev DB), so the text->uuid conversion is a value-
-- preserving cast — no id minting or FK remap of the ids themselves is needed.
--
-- fundive keeps the original *_pkey constraint names after these renames, so
-- they are intentionally left untouched here.

begin;

-- ── EO_prices -> prices ──────────────────────────────────────────────────────
alter table public."EO_prices" rename to prices;
alter table public.prices rename column _id to id;

-- ── EO_rooms -> rooms ────────────────────────────────────────────────────────
alter table public."EO_rooms" rename to rooms;
alter table public.rooms rename column _id to id;

-- ── Other_Addons -> addons ───────────────────────────────────────────────────
alter table public."Other_Addons" rename to addons;
alter table public.addons rename column _id to id;

-- ── DiveTravel -> dive_travel (text _id -> uuid id + fundive-only columns) ────
alter table public."DiveTravel" rename to dive_travel;
alter table public.dive_travel rename column _id to id;
alter table public.dive_travel alter column id type uuid using id::uuid;
alter table public.dive_travel add column if not exists trip_link text;
alter table public.dive_travel add column if not exists planned_trip boolean;
alter table public.dive_travel add column if not exists details_document text;
alter table public.dive_travel add column if not exists local_event_link text;

-- ── TravelDestinations -> travel_destinations (text _id -> uuid id) ──────────
alter table public."TravelDestinations" rename to travel_destinations;
alter table public.travel_destinations rename column _id to id;
alter table public.travel_destinations alter column id type uuid using id::uuid;

-- ── cancellation_policies (_id text -> id uuid; fix the column spelling) ─────
alter table public.cancellation_policies rename column _id to id;
alter table public.cancellation_policies alter column id type uuid using id::uuid;
alter table public.cancellation_policies rename column cancelation_policy to cancellation_policy;

commit;

notify pgrst, 'reload schema';
