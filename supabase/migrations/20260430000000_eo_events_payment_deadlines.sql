-- Per-event payment deadlines.
--
-- The registration form lets divers pay either the full amount or the
-- deposit only; the form + emailed PDF need to show two deadlines:
--   * deposit_deadline       — last day to pay the deposit ("hold your spot")
--   * full_payment_deadline  — last day to pay the remaining balance
--
-- Both are nullable: when admins haven't set them on a legacy event the
-- client falls back to "7 days before start_date".
--
-- No new RLS policy needed — the existing
--   "EO_dives: admin update"   (20260425000000_eo_admin_writes.sql)
--   "EO_courses: admin update"
-- policies gate all column writes through public.is_admin(), so admins
-- can write these new columns automatically. Public select RLS likewise
-- already exposes every column on these tables.

begin;

alter table public."EO_dives"
  add column if not exists deposit_deadline      date,
  add column if not exists full_payment_deadline date;

alter table public."EO_courses"
  add column if not exists deposit_deadline      date,
  add column if not exists full_payment_deadline date;

-- Force PostgREST to flush its schema cache so the new columns are
-- queryable immediately. Without this the first request after the
-- migration applies sometimes gets PGRST204 ("column not found in
-- schema cache") on the freshly-added columns.
notify pgrst, 'reload schema';

commit;
