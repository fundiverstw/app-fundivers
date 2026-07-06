-- Scheduled Trips — the shop's own curated, dated trips.
--
-- These are OURS: a boat trip, liveaboard, or away weekend the shop runs on a
-- fixed date. Divers browse them and, when a trip is linked to a catalog event,
-- register for it through the normal booking flow.
--
-- Modeled as its own table (title / destination / dates / pitch live here) so a
-- scheduled trip is a first-class curated object, independent of the generic
-- `events` catalog — with an OPTIONAL `event_id` link. When set, the diver card
-- routes to /register/<kind>/<event_id>; when null, the trip is informational.
--
-- This is the admin-managed source for the diver Scheduled Trips tab, giving it
-- a one-to-one admin counterpart (like Packages / Trusted Partners). Distinct
-- from `packages` (open-ended travel abroad, booked at a partner shop) and from
-- the `events.is_trip` flag (a Wix-facing classification on the catalog row).
--
-- Access mirrors Packages: the base table is admin-only; divers read published
-- rows through the list_scheduled_trips() SECURITY DEFINER function.

begin;

create table public.scheduled_trips (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  title          text not null,
  destination    text not null,
  summary        text,
  description    text,
  start_date     date,
  end_date       date,
  price          numeric(10,2) check (price is null or price >= 0),
  currency       text not null default 'TWD',
  hero_image_url text,
  highlights     text[] not null default '{}',
  status         text not null default 'draft'
    check (status in ('draft','published','archived')),
  published_at   timestamptz,
  -- Optional link to a bookable catalog event. on delete set null so deleting
  -- the event leaves the (now informational) scheduled trip intact.
  event_id       uuid references public.events(id) on delete set null,
  created_by     uuid references public.profiles(id),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create index scheduled_trips_published_idx on public.scheduled_trips (status, start_date)
  where status = 'published';
create index scheduled_trips_event_idx on public.scheduled_trips (event_id);

alter table public.scheduled_trips enable row level security;

create policy "scheduled_trips: admin manage" on public.scheduled_trips
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Diver-facing read: published trips only, carrying the linked event's kind so
-- the client can build the /register/<kind>/<event_id> link. SECURITY DEFINER
-- with a pinned search_path so divers never touch the admin-only base table.
create or replace function public.list_scheduled_trips()
returns table (
  id uuid, title text, destination text, summary text, description text,
  start_date date, end_date date, price numeric, currency text,
  hero_image_url text, highlights text[], published_at timestamptz,
  event_id uuid, event_kind text)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id, s.title, s.destination, s.summary, s.description,
    s.start_date, s.end_date, s.price, s.currency,
    s.hero_image_url, s.highlights, s.published_at,
    s.event_id, e.kind
  from public.scheduled_trips s
  left join public.events e on e.id = s.event_id
  where s.status = 'published'
$$;

grant execute on function public.list_scheduled_trips() to authenticated, anon, service_role;

commit;

notify pgrst, 'reload schema';
