-- Soft-cancellation for EO_dives + EO_courses.
--
-- An admin marks an event as cancelled by setting cancelled_at = now().
-- The event then disappears from calendar / listing reads
-- (fetchEventsInRange in src/lib/events.ts adds an `is null` filter)
-- but remains queryable by id so existing bookings can still resolve
-- their event details on the bookings page. Cancellation is reversible:
-- admins can clear cancelled_at to restore the event.
--
-- Distinct from the diver-side `cancel_date` / `cancel_policy` columns
-- already present on EO_dives — those describe the deadline and policy
-- text by which a diver may cancel their own booking, not whether the
-- event itself has been cancelled by the shop.

begin;

alter table public."EO_dives"
  add column if not exists cancelled_at timestamptz;

alter table public."EO_courses"
  add column if not exists cancelled_at timestamptz;

-- Partial indexes: most rows will have cancelled_at = null; admin
-- list / calendar reads filter on `cancelled_at is null`, which the
-- planner can satisfy with the un-indexed scan since most rows match.
-- Index only the rare cancelled rows so admin "show cancelled" views
-- (if added later) stay fast without bloating the index for the hot path.
create index if not exists "EO_dives_cancelled_at_idx"
  on public."EO_dives" (cancelled_at)
  where cancelled_at is not null;

create index if not exists "EO_courses_cancelled_at_idx"
  on public."EO_courses" (cancelled_at)
  where cancelled_at is not null;

commit;
