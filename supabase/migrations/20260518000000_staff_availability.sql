-- Staff availability — let staff/admin users mark themselves "busy" for
-- a period so admins don't assign duties that collide with vacation,
-- another commitment, etc. The calendar overlays these as a separate
-- band; the duty assignment trigger blocks any overlap at the DB level
-- so a bad UI can't sneak a clash through.
--
-- Schema choice: start_date + start_time + end_date. There is no
-- end_time on purpose — "busy from Friday 2pm through end-of-Sunday" is
-- the dominant shape; finer-grained intra-day blocks aren't a need yet.
-- The end-of-day semantics are implicit: end_date is inclusive.
--
-- Visibility: staff see their own rows. Admin sees everyone's. Divers
-- have no access at all (no policy = no rows under RLS).

begin;

create table public.staff_availability (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  start_date  date not null,
  start_time  time not null,
  end_date    date not null,
  title       text not null check (char_length(title) between 1 and 200),
  details     text check (details is null or char_length(details) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint staff_availability_date_order check (end_date >= start_date)
);

create index staff_availability_user_idx  on public.staff_availability (user_id, start_date);
create index staff_availability_range_idx on public.staff_availability (start_date, end_date);

-- Touch updated_at on every row mutation, per the existing per-table
-- convention (touch_dive_log_updated_at, etc.).
create or replace function public.touch_staff_availability_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_staff_availability_touch_updated_at
  before update on public.staff_availability
  for each row execute function public.touch_staff_availability_updated_at();

-- Owner must be a staff or admin profile. Mirrors duties_enforce_assignee_is_admin.
create or replace function public.staff_availability_enforce_owner_role() returns trigger
  language plpgsql as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = new.user_id and role in ('admin','staff')
  ) then
    raise exception 'staff_availability.user_id must reference a profile with role in (admin, staff) (got %)', new.user_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger staff_availability_owner_role_trg
  before insert or update of user_id on public.staff_availability
  for each row execute function public.staff_availability_enforce_owner_role();

-- RLS.
alter table public.staff_availability enable row level security;

-- Staff see their own; admin sees everyone's.
create policy "staff_availability: select own or admin"
  on public.staff_availability for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Insert/update/delete: only on your own rows, and only if you're staff/admin.
-- (is_staff_or_admin() prevents a future role downgrade from letting a
-- diver write new busy rows; the trigger above blocks owner mismatches.)
create policy "staff_availability: insert own"
  on public.staff_availability for insert to authenticated
  with check (user_id = auth.uid() and public.is_staff_or_admin());

create policy "staff_availability: update own"
  on public.staff_availability for update to authenticated
  using      (user_id = auth.uid() and public.is_staff_or_admin())
  with check (user_id = auth.uid() and public.is_staff_or_admin());

create policy "staff_availability: delete own"
  on public.staff_availability for delete to authenticated
  using (user_id = auth.uid() and public.is_staff_or_admin());

-- Duties: reject any assignment whose date range overlaps a
-- staff_availability row for the assignee. Date-range overlap only —
-- duties are date-granular so intra-day times don't enter.
--
-- A duty with end_date=null is treated as a single-day duty
-- (start_date..start_date).
create or replace function public.duties_enforce_no_busy_overlap() returns trigger
  language plpgsql as $$
declare
  duty_end date := coalesce(new.end_date, new.start_date);
begin
  if exists (
    select 1 from public.staff_availability sa
    where sa.user_id = new.assignee_id
      and sa.start_date <= duty_end
      and sa.end_date   >= new.start_date
  ) then
    raise exception 'duties: assignee % is marked busy during % .. %', new.assignee_id, new.start_date, duty_end
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger duties_no_busy_overlap_trg
  before insert or update of assignee_id, start_date, end_date on public.duties
  for each row execute function public.duties_enforce_no_busy_overlap();

commit;
