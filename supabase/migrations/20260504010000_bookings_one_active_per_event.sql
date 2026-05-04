-- Tighten the per-(user, event) unique guard so it counts only
-- non-cancelled rows. The original migration (20260421150000) had a
-- wide partial unique index on (user_id, eo_dive_id) / (user_id,
-- eo_course_id), which preserved audit rows but also blocked a diver
-- from re-registering after a cancellation. Replacing those indexes
-- with cancelled-aware variants keeps the audit trail intact and lets
-- the admin (or the diver themselves) re-register after a cancel.

drop index if exists public.bookings_user_dive_uniq;
drop index if exists public.bookings_user_course_uniq;

create unique index if not exists bookings_one_active_dive_per_user_idx
  on public.bookings (user_id, eo_dive_id)
  where eo_dive_id is not null and status <> 'cancelled';

create unique index if not exists bookings_one_active_course_per_user_idx
  on public.bookings (user_id, eo_course_id)
  where eo_course_id is not null and status <> 'cancelled';
