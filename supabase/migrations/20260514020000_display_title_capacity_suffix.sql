-- Capacity status baked into display_title.
--
-- Rather than teach every reader (PWA, Wix calendar, future surfaces)
-- about capacity counting, we maintain display_title as
-- `<base> <capacity suffix>` server-side. The Wix site picks the change
-- up through the existing wix_sync_* triggers without any Velo edit.
--
-- Suffix rules (matches user spec):
--   remaining = 0 OR fully_booked → ' (fully booked -- register for waitlist)'
--   remaining = 1                 → ' (1 spot open)'
--   remaining = 2                 → ' (2 spots open)'
--   anything else                 → ''   (uncapped or plenty of room)
--
-- "remaining" counts ONLY status='confirmed' bookings. Pending / waitlisted
-- don't reserve a seat (consistent with set_waitlisted_when_event_full()).
--
-- Pipeline:
--   • BEFORE INSERT/UPDATE on EO_dives + EO_courses normalizes display_title
--     by stripping any previously-baked suffix and re-appending the live one.
--     This catches admin saves where the form sent back the polluted title,
--     and lets capacity / fully_booked changes recompute in the same write.
--   • AFTER INSERT/UPDATE/DELETE on bookings refreshes the affected event's
--     display_title via a follow-up UPDATE (guarded by IS DISTINCT FROM so a
--     no-op change doesn't fire wix_sync needlessly).
--
-- Backfill at the bottom kicks every existing event through the function so
-- the suffix is correct from the first deploy onward.

begin;

-- ============================================================
-- 1. Helpers
-- ============================================================

-- Strip any previously-baked suffix from a title so we can re-append the
-- live one cleanly. Tolerates either spelling of the en/em dash and either
-- "spot" / "spots". Greedy-anchored at end-of-string only.
create or replace function public.strip_capacity_suffix(p_title text) returns text
  language sql immutable as $$
  select regexp_replace(
    coalesce(p_title, ''),
    '\s*\((?:\d+\s*spots?\s*open|fully booked\s*[-–—]+\s*register for waitlist)\)\s*$',
    '',
    'i'
  );
$$;

-- Compute the suffix string for a given (capacity, fully_booked, confirmed)
-- triple. Pure function — no table reads — so it's cheap and reusable.
create or replace function public.capacity_suffix(
  p_capacity     int,
  p_fully_booked boolean,
  p_confirmed    int
)
returns text language plpgsql immutable as $$
declare
  v_remaining int;
begin
  if coalesce(p_fully_booked, false) then
    return ' (fully booked -- register for waitlist)';
  end if;
  if p_capacity is null then
    return '';
  end if;
  v_remaining := greatest(0, p_capacity - coalesce(p_confirmed, 0));
  if v_remaining = 0 then return ' (fully booked -- register for waitlist)'; end if;
  if v_remaining = 1 then return ' (1 spot open)'; end if;
  if v_remaining = 2 then return ' (2 spots open)'; end if;
  return '';
end;
$$;

-- Count confirmed bookings on one event. SECURITY DEFINER so the AFTER
-- trigger on bookings can call it past whatever RLS context the caller has.
create or replace function public.event_confirmed_count_one(
  p_event_type text,
  p_event_id   uuid
)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.bookings
  where status = 'confirmed'
    and case when p_event_type = 'dive'
             then eo_dive_id   = p_event_id
             else eo_course_id = p_event_id end;
$$;
revoke execute on function public.event_confirmed_count_one(text, uuid) from public;
grant  execute on function public.event_confirmed_count_one(text, uuid) to service_role;

-- ============================================================
-- 2. BEFORE INSERT/UPDATE normalizer on EO_dives + EO_courses
-- ============================================================
-- Every write to one of these rows goes through here. Admin form save,
-- capacity edits, the bookings-triggered refresh below — all converge on
-- `display_title = strip(NEW.display_title) || capacity_suffix(...)`.

create or replace function public.eo_event_normalize_display_title()
returns trigger language plpgsql as $$
declare
  v_type      text;
  v_event_id  uuid;
  v_base      text;
  v_confirmed int;
begin
  v_type := case TG_TABLE_NAME when 'EO_dives' then 'dive' else 'course' end;
  v_event_id := new._id;
  v_base := public.strip_capacity_suffix(new.display_title);
  -- For BEFORE INSERT there are no bookings yet for a brand-new uuid; the
  -- count comes back as 0, suffix logic still produces the right answer.
  v_confirmed := public.event_confirmed_count_one(v_type, v_event_id);
  new.display_title := v_base || public.capacity_suffix(
    new.capacity,
    coalesce(new.fully_booked, false),
    v_confirmed
  );
  return new;
end;
$$;

drop trigger if exists trg_eo_dives_normalize_title   on public."EO_dives";
drop trigger if exists trg_eo_courses_normalize_title on public."EO_courses";

create trigger trg_eo_dives_normalize_title
  before insert or update on public."EO_dives"
  for each row execute function public.eo_event_normalize_display_title();

create trigger trg_eo_courses_normalize_title
  before insert or update on public."EO_courses"
  for each row execute function public.eo_event_normalize_display_title();

-- ============================================================
-- 3. AFTER trigger on bookings → refresh the affected event's title
-- ============================================================
-- Rules:
--   • INSERT: refresh the event the booking points at.
--   • UPDATE: refresh when status changes (only status flips can change a
--     confirmed-count). Also refresh if eo_dive_id / eo_course_id swap (rare;
--     would need a refresh on both sides) — we just refresh both.
--   • DELETE: refresh the event that booking pointed at.
-- The UPDATE inside refresh_event_display_title is gated by
-- `IS DISTINCT FROM` so a no-op write never reaches wix_sync.

create or replace function public.refresh_event_display_title(
  p_event_type text,
  p_event_id   uuid
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_current     text;
  v_capacity    int;
  v_fully       boolean;
  v_confirmed   int;
  v_new_title   text;
begin
  if p_event_id is null then return; end if;

  if p_event_type = 'dive' then
    select display_title, capacity, coalesce(fully_booked, false)
      into v_current, v_capacity, v_fully
    from public."EO_dives" where _id = p_event_id;
  else
    select display_title, capacity, coalesce(fully_booked, false)
      into v_current, v_capacity, v_fully
    from public."EO_courses" where _id = p_event_id;
  end if;

  if v_current is null and v_capacity is null and not v_fully then
    return; -- no base title and nothing to append; leave it alone.
  end if;

  v_confirmed := public.event_confirmed_count_one(p_event_type, p_event_id);
  v_new_title := public.strip_capacity_suffix(coalesce(v_current, ''))
              || public.capacity_suffix(v_capacity, v_fully, v_confirmed);

  if p_event_type = 'dive' then
    update public."EO_dives"
       set display_title = v_new_title
     where _id = p_event_id and display_title is distinct from v_new_title;
  else
    update public."EO_courses"
       set display_title = v_new_title
     where _id = p_event_id and display_title is distinct from v_new_title;
  end if;
end;
$$;
revoke execute on function public.refresh_event_display_title(text, uuid) from public;
grant  execute on function public.refresh_event_display_title(text, uuid) to service_role;

create or replace function public.trg_bookings_refresh_event_title()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    if new.eo_dive_id   is not null then perform public.refresh_event_display_title('dive',   new.eo_dive_id);   end if;
    if new.eo_course_id is not null then perform public.refresh_event_display_title('course', new.eo_course_id); end if;
  elsif TG_OP = 'UPDATE' then
    if new.status is distinct from old.status then
      if coalesce(new.eo_dive_id,   old.eo_dive_id)   is not null then perform public.refresh_event_display_title('dive',   coalesce(new.eo_dive_id,   old.eo_dive_id));   end if;
      if coalesce(new.eo_course_id, old.eo_course_id) is not null then perform public.refresh_event_display_title('course', coalesce(new.eo_course_id, old.eo_course_id)); end if;
    end if;
  elsif TG_OP = 'DELETE' then
    if old.eo_dive_id   is not null then perform public.refresh_event_display_title('dive',   old.eo_dive_id);   end if;
    if old.eo_course_id is not null then perform public.refresh_event_display_title('course', old.eo_course_id); end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_bookings_refresh_title on public.bookings;
create trigger trg_bookings_refresh_title
  after insert or update or delete on public.bookings
  for each row execute function public.trg_bookings_refresh_event_title();

-- ============================================================
-- 4. Backfill — kick every existing event through the normalizer
-- ============================================================
-- A no-op UPDATE wakes up the BEFORE trigger which rewrites display_title.
-- The IS DISTINCT FROM guard inside refresh_event_display_title keeps this
-- from sending wix webhooks for rows whose computed title already matches.

do $$
declare r record;
begin
  for r in select _id from public."EO_dives" loop
    update public."EO_dives" set display_title = display_title where _id = r._id;
  end loop;
  for r in select _id from public."EO_courses" loop
    update public."EO_courses" set display_title = display_title where _id = r._id;
  end loop;
end $$;

commit;
