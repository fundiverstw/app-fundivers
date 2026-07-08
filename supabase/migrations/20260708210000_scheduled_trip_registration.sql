-- Scheduled Trips → self-contained registration. A trip now carries catalog
-- add-ons/rooms and a diver registers directly (estimate + notify the shop),
-- mirroring Packages minus tiers/partner/kickback. The old event-link
-- registration is dropped. Pre-production: 0 rows in prod + local, so dropping
-- event_id loses no data.

-- 1. Reshape `scheduled_trips`: add catalog references, drop the event link.
alter table public.scheduled_trips
  drop column if exists event_id,   -- also drops its FK + scheduled_trips_event_idx
  add column addon_ids uuid[] not null default '{}'::uuid[],
  add column room_type_ids uuid[] not null default '{}'::uuid[];

-- 2. Registrations. One row per diver-registration; carries the frozen estimate
--    snapshot. No kickback ledger — these are the shop's own trips.
create table public.scheduled_trip_registrations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  scheduled_trip_id uuid not null references public.scheduled_trips(id) on delete cascade,
  diver_id uuid not null references public.profiles(id) on delete cascade,
  estimated_cost numeric(10,2),
  estimated_currency text,
  details jsonb not null default '{}'::jsonb,
  notes text,
  status text not null default 'registered',
  admin_notes text,
  constraint scheduled_trip_registrations_status_check
    check (status = any (array['registered'::text, 'completed'::text, 'cancelled'::text])),
  constraint scheduled_trip_registrations_estimated_cost_check
    check (estimated_cost is null or estimated_cost >= 0::numeric)
);
create index scheduled_trip_registrations_diver_idx on public.scheduled_trip_registrations using btree (diver_id);
create index scheduled_trip_registrations_trip_idx on public.scheduled_trip_registrations using btree (scheduled_trip_id);
-- One live registration per diver per trip; a cancelled one frees a retry.
create unique index scheduled_trip_registrations_one_live_idx
  on public.scheduled_trip_registrations using btree (scheduled_trip_id, diver_id)
  where (status <> 'cancelled'::text);
alter table public.scheduled_trip_registrations enable row level security;
create policy "scheduled_trip_registrations: admin manage" on public.scheduled_trip_registrations
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- 3. Diver-facing SECURITY DEFINER reads. Base tables are admin-only.

-- Rewrite the board projection: drop the event join/columns, add the catalog ids.
-- (Return-type change → drop first; CREATE OR REPLACE can't alter the signature.)
drop function if exists public.list_scheduled_trips();
create or replace function public.list_scheduled_trips() returns table(
  "id" uuid, "title" text, "destination" text, "summary" text, "description" text,
  "start_date" date, "end_date" date, "price" numeric, "currency" text,
  "hero_image_url" text, "highlights" text[], "addon_ids" uuid[], "room_type_ids" uuid[],
  "published_at" timestamptz)
  language sql stable security definer set search_path to 'public'
  as $$
  select
    s.id, s.title, s.destination, s.summary, s.description,
    s.start_date, s.end_date, s.price, s.currency,
    s.hero_image_url, s.highlights, s.addon_ids, s.room_type_ids, s.published_at
  from public.scheduled_trips s
  where s.status = 'published'
$$;
alter function public.list_scheduled_trips() owner to postgres;

-- The caller's own registrations with trip labels + estimate.
create or replace function public.list_my_scheduled_trip_registrations() returns table(
  "id" uuid, "scheduled_trip_id" uuid, "status" text, "created_at" timestamptz,
  "estimated_cost" numeric, "estimated_currency" text,
  "trip_title" text, "trip_destination" text, "trip_start_date" date, "trip_end_date" date)
  language sql stable security definer set search_path to 'public'
  as $$
  select
    r.id, r.scheduled_trip_id, r.status, r.created_at,
    r.estimated_cost, r.estimated_currency,
    s.title, s.destination, s.start_date, s.end_date
  from public.scheduled_trip_registrations r
  join public.scheduled_trips s on s.id = r.scheduled_trip_id
  where r.diver_id = auth.uid()
$$;
alter function public.list_my_scheduled_trip_registrations() owner to postgres;

-- Diver-owned cancel (base table is admin-only), scoped to their own row.
create or replace function public.cancel_my_scheduled_trip_registration("p_id" uuid) returns void
  language sql security definer set search_path to 'public'
  as $$
  update public.scheduled_trip_registrations set status = 'cancelled'
  where id = p_id and diver_id = auth.uid() and status <> 'cancelled'
$$;
alter function public.cancel_my_scheduled_trip_registration(uuid) owner to postgres;

grant all on function public.list_scheduled_trips() to authenticated, anon, service_role;
grant all on function public.list_my_scheduled_trip_registrations() to authenticated, anon, service_role;
grant all on function public.cancel_my_scheduled_trip_registration(uuid) to authenticated, service_role;

-- Reload the PostgREST schema cache so the new table is API-exposed immediately
-- after `make push` (a fresh table 404s from the REST API until PostgREST reloads).
notify pgrst, 'reload schema';
