-- Event capacity.
--
-- `capacity` (NULL = uncapped) caps how many confirmed bookings an event
-- accepts. Pending bookings do not occupy a spot — only status='confirmed'
-- does. When capacity is filled, new bookings land on the waitlist
-- (same trigger that already honors the manual fully_booked flag).
--
-- Divers see capacity-derived state via the event_confirmed_counts() RPC,
-- which bypasses RLS so an aggregate count is visible without leaking
-- individual bookings.

begin;

-- 1. Column. Nullable on purpose: legacy events stay uncapped until an
--    admin sets a number.
alter table public."EO_dives"   add column if not exists capacity integer;
alter table public."EO_courses" add column if not exists capacity integer;

alter table public."EO_dives"   add constraint eo_dives_capacity_nonneg
  check (capacity is null or capacity >= 0) not valid;
alter table public."EO_courses" add constraint eo_courses_capacity_nonneg
  check (capacity is null or capacity >= 0) not valid;

-- 2. RPC: aggregate confirmed-booking counts for a batch of event ids.
--    SECURITY DEFINER so divers see real numbers — RLS on bookings would
--    otherwise hide every row that isn't theirs and the count would be 0.
--    Returns one row per event that has at least one confirmed booking;
--    callers default missing entries to 0.
create or replace function public.event_confirmed_counts(
  p_dive_ids   uuid[],
  p_course_ids uuid[]
)
returns table (event_id uuid, event_type text, n int)
language sql security definer set search_path = public as $$
  select eo_dive_id, 'dive'::text, count(*)::int
  from public.bookings
  where status = 'confirmed' and eo_dive_id = any(coalesce(p_dive_ids, '{}'::uuid[]))
  group by eo_dive_id
  union all
  select eo_course_id, 'course'::text, count(*)::int
  from public.bookings
  where status = 'confirmed' and eo_course_id = any(coalesce(p_course_ids, '{}'::uuid[]))
  group by eo_course_id;
$$;

revoke execute on function public.event_confirmed_counts(uuid[], uuid[]) from public;
grant  execute on function public.event_confirmed_counts(uuid[], uuid[]) to authenticated;

-- 3. Update the waitlist gate so it also flips to 'waitlisted' when a
--    capacity-set event has hit its cap. Manual fully_booked still works
--    as an explicit override; the check is OR-ed.
create or replace function public.set_waitlisted_when_event_full()
returns trigger language plpgsql as $$
declare
  v_full        boolean := false;
  v_capacity    int;
  v_confirmed   int;
begin
  if new.status = 'pending' then
    if new.eo_dive_id is not null then
      select coalesce(fully_booked, false), capacity
        into v_full, v_capacity
      from public."EO_dives" where _id = new.eo_dive_id;
    elsif new.eo_course_id is not null then
      select coalesce(fully_booked, false), capacity
        into v_full, v_capacity
      from public."EO_courses" where _id = new.eo_course_id;
    end if;

    if not v_full and v_capacity is not null then
      select count(*)::int into v_confirmed
      from public.bookings
      where status = 'confirmed'
        and (
          (new.eo_dive_id   is not null and eo_dive_id   = new.eo_dive_id) or
          (new.eo_course_id is not null and eo_course_id = new.eo_course_id)
        );
      if v_confirmed >= v_capacity then
        v_full := true;
      end if;
    end if;

    if v_full then
      new.status := 'waitlisted';
    end if;
  end if;
  return new;
end;
$$;

commit;
