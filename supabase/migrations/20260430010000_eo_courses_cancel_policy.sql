-- Cancellation policy linkage on EO_courses, mirroring the existing
-- EO_dives.cancel_policy FK from 20260429000000_dive_travel_and_cancellation_policies.sql.
--
-- The registration form needs to display the event's cancellation policy
-- (and require diver acknowledgement) for every event type, not just
-- dives. cancel_date carries the per-event cancellation deadline that
-- the policy text references; both columns are nullable so legacy
-- courses without a configured policy keep loading.
--
-- No new RLS policy needed — the existing "EO_courses: admin update"
-- policy from 20260425000000_eo_admin_writes.sql already gates writes
-- through public.is_admin() on every column.

begin;

alter table public."EO_courses"
  add column if not exists cancel_date  date,
  add column if not exists cancel_policy text;

-- FK to cancellation_policies — matches the EO_dives constraint shape.
-- on delete set null so deleting a policy doesn't cascade-break courses.
-- Wrapped in a do-block + pg_constraint check so the migration is safe
-- to re-run on environments where the FK was added out-of-band (the
-- cloud DB hit this case on first push).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'EO_courses_cancel_policy_fkey'
      and conrelid = 'public."EO_courses"'::regclass
  ) then
    alter table public."EO_courses"
      add constraint "EO_courses_cancel_policy_fkey"
      foreign key ("cancel_policy")
      references public.cancellation_policies ("_id")
      on update cascade
      on delete set null;
  end if;
end$$;

create index if not exists "EO_courses_cancel_policy_idx"
  on public."EO_courses" ("cancel_policy")
  where "cancel_policy" is not null;

notify pgrst, 'reload schema';

commit;
