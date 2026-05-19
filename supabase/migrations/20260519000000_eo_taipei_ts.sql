-- Generated `timestamptz` columns for every date column on EO_dives and
-- EO_courses, anchored to Asia/Taipei (UTC+08:00).
--
-- Motivation: the wix_sync triggers POST raw row JSON to Velo, where
-- Wix's DateTime field needs a real ISO timestamp — `"2027-05-15"` from
-- our `date` columns trips a Wix coercion warning every sync. Generated
-- columns let us hand Velo a clean `start_ts` etc. without touching the
-- underlying date/time columns the SPA already depends on.
--
-- Why a fixed `+08:00` offset rather than `Asia/Taipei`: generated STORED
-- columns require an IMMUTABLE expression, and Postgres's IANA-zone
-- casts are STABLE (the zone database can change). Taiwan has never
-- observed DST and the offset is permanently +08:00, so a fixed offset
-- is both correct and IMMUTABLE-safe.

begin;

create or replace function public.taipei_ts(d date, t time)
returns timestamptz
language sql
immutable
as $$
  select case
    when d is null then null
    else ((d::text || ' ' || coalesce(t, time '00:00:00')::text || '+08:00')::timestamptz)
  end
$$;

alter table public."EO_dives"
  add column start_ts                 timestamptz generated always as (public.taipei_ts(start_date,            "time")) stored,
  add column end_ts                   timestamptz generated always as (public.taipei_ts(end_date,              "time")) stored,
  add column cancel_date_ts           timestamptz generated always as (public.taipei_ts(cancel_date,            null))  stored,
  add column deposit_deadline_ts      timestamptz generated always as (public.taipei_ts(deposit_deadline,       null))  stored,
  add column full_payment_deadline_ts timestamptz generated always as (public.taipei_ts(full_payment_deadline,  null))  stored;

alter table public."EO_courses"
  add column start_ts                 timestamptz generated always as (public.taipei_ts(start_date,            start_time)) stored,
  add column end_ts                   timestamptz generated always as (public.taipei_ts(end_date,              start_time)) stored,
  add column special_ts               timestamptz generated always as (public.taipei_ts(special_date,           null))      stored,
  add column cancel_date_ts           timestamptz generated always as (public.taipei_ts(cancel_date,            null))      stored,
  add column deposit_deadline_ts      timestamptz generated always as (public.taipei_ts(deposit_deadline,       null))      stored,
  add column full_payment_deadline_ts timestamptz generated always as (public.taipei_ts(full_payment_deadline,  null))      stored;

notify pgrst, 'reload schema';

commit;
