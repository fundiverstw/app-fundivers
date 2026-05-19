-- Reverts 20260519000000_eo_taipei_ts.sql. The Wix-sync timestamptz
-- approach is being abandoned; drop the generated columns and the
-- taipei_ts helper rather than leave dead schema behind.

begin;

alter table public."EO_dives"
  drop column if exists start_ts,
  drop column if exists end_ts,
  drop column if exists cancel_date_ts,
  drop column if exists deposit_deadline_ts,
  drop column if exists full_payment_deadline_ts;

alter table public."EO_courses"
  drop column if exists start_ts,
  drop column if exists end_ts,
  drop column if exists special_ts,
  drop column if exists cancel_date_ts,
  drop column if exists deposit_deadline_ts,
  drop column if exists full_payment_deadline_ts;

drop function if exists public.taipei_ts(date, time);

notify pgrst, 'reload schema';

commit;
