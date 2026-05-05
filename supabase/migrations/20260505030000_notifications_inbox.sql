-- public.notifications — per-user inbox of notifications. Mirrors what
-- gets sent over Web Push but persists independently so:
--   1. Users without push (iOS not installed to Home Screen) still see
--      their reminders / broadcasts / duty assignments inside the app.
--   2. Users can scroll history (Web Push doesn't keep a queue).
--
-- Fan-out: one row per recipient even for broadcasts. Bigger storage
-- footprint, but reads are trivial (single-table user-id index) and we
-- avoid a join table for read-state. If broadcasts ever need to be
-- recallable / editable as a single entity, a separate `broadcasts`
-- table can be added later and this table referenced via a nullable
-- broadcast_id FK.
--
-- Writes come from the push worker (service-role, bypasses RLS); reads
-- and read-state UPDATEs come from the SPA as the diver themselves.

begin;

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  body        text,
  url         text,
  /** 'reminder' (cron event/payment), 'broadcast' (admin-fan-out),
   *  'duty' (duty assignment), open-ended for future kinds. */
  kind        text not null,
  /** Optional EO_dives._id / EO_courses._id (text both post-uuid migration);
   *  no FK because it can point at either table. NULL when not event-bound. */
  event_id    text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index notifications_user_unread_idx
  on public.notifications (user_id)
  where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists "notifications: own select" on public.notifications;
drop policy if exists "notifications: own update" on public.notifications;

create policy "notifications: own select"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

-- UPDATE intentionally allows the diver to touch their own row freely.
-- The only thing the SPA writes is read_at (mark-as-read), and any other
-- edit they make to the title/body/etc. only affects their own private
-- view of their own notification — no leakage, no escalation.
create policy "notifications: own update"
  on public.notifications for update to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No INSERT or DELETE policies. INSERTs come exclusively from the push
-- worker over the service-role connection (bypasses RLS). DELETEs are
-- not exposed today — old rows just accumulate. Add a cron prune later
-- if we care.

commit;
