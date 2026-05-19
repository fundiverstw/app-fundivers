-- Drops the deposit_deadline column from EO_dives and EO_courses.
-- Standard policy is "pay the deposit ASAP to hold your spot" — the
-- registration form already says exactly that, so the per-event
-- deadline column has no UI consumer. full_payment_deadline stays.

begin;

alter table public."EO_dives"   drop column if exists deposit_deadline;
alter table public."EO_courses" drop column if exists deposit_deadline;

notify pgrst, 'reload schema';

commit;
