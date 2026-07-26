-- Pin search_path on the two dive_logs trigger functions.
--
-- 42 of the 56 functions in the baseline set it; these two were part of the
-- minority that didn't. Both run as INVOKER and already schema-qualify their
-- table reference, so this closes a consistency gap rather than an open hole —
-- but an unpinned search_path is exactly the thing that turns a later,
-- less-careful edit into a real one.
--
-- CREATE OR REPLACE keeps the existing triggers bound; no re-attach needed.

create or replace function public.set_dive_log_number() returns trigger
  language plpgsql
  set search_path to 'public'
  as $$
begin
  if new.dive_number is null then
    perform pg_advisory_xact_lock(hashtext(new.user_id::text));
    select coalesce(max(dive_number), 0) + 1
      into new.dive_number
      from public.dive_logs
      where user_id = new.user_id;
  end if;
  return new;
end;
$$;

create or replace function public.touch_dive_log_updated_at() returns trigger
  language plpgsql
  set search_path to 'public'
  as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
