-- Track which admin/staff members are on duty for events (or standalone
-- tasks). Each duty records: assignee, role, period, optional event link,
-- and optional notes. Per user spec, there is no XOR between
-- eo_dive_id and eo_course_id — a duty may point to neither, one, or
-- (theoretically) both. The Duty tab surfaces gaps; the DB stays permissive.
--
-- The assignee must be an admin. That can't be a plain CHECK constraint
-- (CHECKs can't cross tables), so a trigger enforces it on insert/update.

begin;

create table public.duties (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id) on delete set null,
  assignee_id   uuid not null references public.profiles(id) on delete cascade,
  role          text not null check (role in ('instructor', 'guide', 'support')),
  start_date    date not null,
  end_date      date,
  eo_dive_id    text references public."EO_dives"(_id)   on delete cascade,
  eo_course_id  text references public."EO_courses"(_id) on delete cascade,
  notes         text check (notes is null or char_length(notes) between 1 and 2000),
  constraint duties_date_order check (end_date is null or end_date >= start_date)
);

create index duties_assignee_idx on public.duties (assignee_id, start_date);
create index duties_dive_idx     on public.duties (eo_dive_id)   where eo_dive_id   is not null;
create index duties_course_idx   on public.duties (eo_course_id) where eo_course_id is not null;
create index duties_date_idx     on public.duties (start_date);

create or replace function public.duties_enforce_assignee_is_admin() returns trigger
  language plpgsql as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = new.assignee_id and role = 'admin'
  ) then
    raise exception 'duties.assignee_id must reference a profile with role=admin (got %)', new.assignee_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger duties_assignee_admin_trg
  before insert or update of assignee_id on public.duties
  for each row execute function public.duties_enforce_assignee_is_admin();

-- RLS: admin-only read + write. Service-role (worker) bypasses automatically.
alter table public.duties enable row level security;

create policy "duties: admin select"
  on public.duties for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "duties: admin insert"
  on public.duties for insert to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "duties: admin update"
  on public.duties for update to authenticated
  using  (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "duties: admin delete"
  on public.duties for delete to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

commit;
