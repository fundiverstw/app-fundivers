-- Recurring events: a series is a rule plus the occurrences generated from it.
--
-- Occurrences are REAL `events` rows, not a rule expanded on read. Every child
-- table -- bookings, duties, event_waivers, event_vehicles, ride groups --
-- points at a concrete event_id, and capacity, the waitlist trigger, the
-- display-title refresh and cancellation all operate on rows. A virtual
-- occurrence would have no id to book against.
--
-- So this table stores only what generating MORE occurrences later needs: the
-- pattern. It holds no dates of its own -- `datesAfter()` re-anchors the rule on
-- the last occurrence -- which means a series can never disagree with the events
-- it produced.
--
-- The occurrences stay fully independent rows: editing or cancelling one is
-- exactly what it was before. series_id only makes the grouping addressable, so
-- "cancel the rest" and "apply to later occurrences" have something to act on.

create table public.event_series (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  -- Admin-facing name for the batch ("Saturday boat dives"). Occurrences carry
  -- their own titles; this only labels the group in admin UI.
  label      text,
  -- Denormalised from the occurrences so the series can be described without
  -- reading one. Pinned to the same vocabulary as events_kind_check.
  kind       text not null,
  freq       text not null,
  "interval" integer not null,
  -- weekly only: ISO weekdays, 1 = Monday .. 7 = Sunday.
  weekdays   smallint[],
  constraint event_series_kind_check check (kind in ('dive', 'course', 'adventure')),
  constraint event_series_freq_check check (freq in ('daily', 'weekly', 'monthly_weekday')),
  -- Mirrors MAX_INTERVAL in src/lib/recurrence.ts.
  constraint event_series_interval_check check ("interval" between 1 and 12),
  constraint event_series_label_check check (label is null or char_length(label) <= 120),
  -- A weekly rule without weekdays would expand to nothing; anything else must
  -- not carry them, or the stored rule would imply a pattern it doesn't have.
  constraint event_series_weekdays_check check (
    case
      when freq = 'weekly' then weekdays is not null and array_length(weekdays, 1) between 1 and 7
      else weekdays is null
    end
  ),
  -- Containment rather than an unnest+bool_and: a CHECK constraint cannot
  -- contain a subquery, and `<@` says "every element is one of these" directly.
  constraint event_series_weekday_range_check check (
    weekdays is null or weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
  )
);

comment on table public.event_series is
  'A recurrence rule and the batch of events generated from it. Stores no dates: the rule is re-anchored on the last occurrence to extend the series.';

alter table public.event_series enable row level security;

-- Staff read it (the admin calendar and event pages are staff-visible);
-- only admins create or change one. Mirrors the events policies, minus the
-- public/anon select: divers see the occurrences, never the rule.
create policy "event_series: staff select" on public.event_series
  for select to authenticated using (public.is_staff_or_admin());
create policy "event_series: admin insert" on public.event_series
  for insert to authenticated with check (public.is_admin());
create policy "event_series: admin update" on public.event_series
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "event_series: admin delete" on public.event_series
  for delete to authenticated using (public.is_admin());

-- Spelled out because a new table in this schema starts with no privileges for
-- the API roles on the incremental migration path, whatever a full db reset
-- hands out. RLS decides which rows; the grant decides which verbs.
grant select, insert, update, delete on table public.event_series to service_role;
grant select, insert, update, delete on table public.event_series to authenticated;

-- ON DELETE SET NULL, emphatically not CASCADE: deleting a series must never
-- delete events divers have booked onto. Dropping the series just un-groups the
-- occurrences, which then behave exactly like hand-made ones.
alter table public.events
  add column if not exists series_id uuid references public.event_series(id) on delete set null;

comment on column public.events.series_id is
  'The recurrence batch this event was generated in, or NULL for a one-off. Grouping only -- the occurrence is independent.';

-- Occurrences are always read as a series ordered by date ("occurrence 3 of 8",
-- "everything after this one").
create index events_series_idx on public.events (series_id, start_date)
  where series_id is not null;
