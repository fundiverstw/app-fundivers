-- Consolidate admin-facing notes into a single `admin_notes` table, replacing
-- `event_memos`. The shape mirrors event_memos (tag + content + resolvable)
-- but adds booking_id so per-diver-per-event notes (e.g. gear-map flags)
-- live in the same place. Exactly one of eo_dive_id / eo_course_id /
-- booking_id is set (XOR), matching the pattern already used by bookings
-- and event_memos.
--
-- event_memos has no production data yet (confirmed), so we skip the
-- insert-into-select data migration and just drop the old table.

begin;

create table public.admin_notes (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  created_by    uuid not null references public.profiles(id) on delete cascade,
  -- XOR target (exactly one must be non-null):
  eo_dive_id    text references public."EO_dives"(_id)   on delete cascade,
  eo_course_id  text references public."EO_courses"(_id) on delete cascade,
  booking_id    uuid references public.bookings(id)      on delete cascade,
  tag           text not null check (tag in (
    'urgent','payment','gear','logistics','cert','medical','note','general'
  )),
  content       text not null check (char_length(content) between 1 and 2000),
  resolved      boolean not null default false,
  resolved_by   uuid references public.profiles(id),
  resolved_at   timestamptz,
  constraint admin_notes_target_xor check (
    (eo_dive_id is not null)::int
    + (eo_course_id is not null)::int
    + (booking_id is not null)::int
    = 1
  ),
  constraint admin_notes_resolved_consistency check (
    (resolved = true  and resolved_by is not null and resolved_at is not null)
    or
    (resolved = false and resolved_by is null     and resolved_at is null)
  )
);

create index admin_notes_dive_idx    on public.admin_notes (eo_dive_id)   where eo_dive_id   is not null;
create index admin_notes_course_idx  on public.admin_notes (eo_course_id) where eo_course_id is not null;
create index admin_notes_booking_idx on public.admin_notes (booking_id)   where booking_id   is not null;
create index admin_notes_open_idx    on public.admin_notes (created_at desc) where resolved = false;

-- RLS: admin-only read + write. Service-role bypasses automatically.
alter table public.admin_notes enable row level security;

create policy "admin_notes: admin select"
  on public.admin_notes for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "admin_notes: admin insert"
  on public.admin_notes for insert to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "admin_notes: admin update"
  on public.admin_notes for update to authenticated
  using  (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "admin_notes: admin delete"
  on public.admin_notes for delete to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

drop table public.event_memos;

commit;
