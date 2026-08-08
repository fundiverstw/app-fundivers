-- One course, finished across two or more scheduled course events.
--
-- A student starts Open Water on the 10th, does the pool day and the first
-- open-water day, then gets sick / the boat is blown out / they have to fly
-- home — and they finish the remaining days with the OW course that runs three
-- weeks later. Today the schema can't say that. A booking pins one diver to one
-- event, so the shop's only options were to leave them on the first course
-- (they vanish from the second course's roster, gear list and headcount) or
-- register them a second time (a duplicate sale, a second balance owed, and a
-- diver who looks like two students to every revenue and capacity view).
--
-- Two columns fix both halves:
--
--   continues_booking_id — the continuation points back at the booking that
--     holds the money. Non-null means "this seat was already paid for on
--     another event"; every money view can therefore leave it alone, and the
--     admin reading either roster can see the pairing.
--
--   attend_days — which of the event's course_days this diver is actually
--     there for. NULL means all of them, which is what every existing booking
--     means and stays the normal case. It is deliberately NOT limited to
--     continuations: the *first* booking needs trimming too, or the day-level
--     gear and headcount views keep packing wetsuits for the days the student
--     didn't stay for.
--
-- Creating one goes through create_course_continuation() below rather than a
-- client insert: the subset-of-course_days rule and the "not already booked on
-- that course" rule are the whole point of the feature, and a check that lives
-- only in the SPA is a check that isn't there.

alter table public.bookings
  add column continues_booking_id uuid references public.bookings(id) on delete set null,
  add column attend_days date[];

comment on column public.bookings.continues_booking_id is
  'The earlier booking this one continues, for a course finished across several scheduled courses. The earlier booking holds the payment; this one is always zero-cost. NULL for a normal booking.';

comment on column public.bookings.attend_days is
  'Subset of the event''s course_days this diver actually attends. NULL = every day, which is the normal case.';

-- An empty array is not a smaller claim than NULL, it is a nonsense one: a
-- booking that attends no days should be cancelled, not zero-dayed.
alter table public.bookings
  add constraint bookings_attend_days_non_empty
  check (attend_days is null or array_length(attend_days, 1) >= 1);

-- Reading a booking's continuations ("has this student finished?") is the
-- lookup direction the UI needs; partial because the column is null on all but
-- a handful of rows.
create index bookings_continues_booking_id_idx
  on public.bookings (continues_booking_id)
  where continues_booking_id is not null;

-- Admin-only, security definer. Validates the pairing, optionally trims the
-- source booking to the days the diver actually attended, and inserts the
-- zero-cost continuation. Returns the new booking id.
create or replace function public.create_course_continuation(
  p_source_booking uuid,
  p_event_id       uuid,
  p_days           date[],
  p_source_days    date[] default null,
  -- The single zero-amount charge line's label, passed in so it reads in the
  -- deployment's language like every other stored charge label, which the
  -- client writes at registration time. Falls back to English.
  p_charge_label   text   default null
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_source        public.bookings;
  v_source_event  public.events;
  v_target        public.events;
  v_details       jsonb;
  v_new_id        uuid;
begin
  if not public.is_admin() then
    raise exception 'only an admin can continue a course booking';
  end if;

  select * into v_source from public.bookings where id = p_source_booking;
  if not found then
    raise exception 'the booking being continued no longer exists';
  end if;
  if v_source.status = 'cancelled' then
    raise exception 'a cancelled booking cannot be continued';
  end if;
  -- A continuation of a continuation would make the money trail a chain to
  -- walk rather than a pair to read. Point the third leg at the original.
  if v_source.continues_booking_id is not null then
    raise exception 'that booking is itself a continuation — continue the original booking instead';
  end if;

  select * into v_source_event from public.events where id = v_source.event_id;
  if v_source_event.kind is distinct from 'course' then
    raise exception 'only a course booking can be continued';
  end if;

  select * into v_target from public.events where id = p_event_id;
  if not found then
    raise exception 'the course to continue on no longer exists';
  end if;
  if v_target.kind <> 'course' then
    raise exception 'a course can only be continued on another course';
  end if;
  if v_target.cancelled_at is not null then
    raise exception 'that course is cancelled';
  end if;
  if p_event_id = v_source.event_id then
    raise exception 'the continuation must be on a different course';
  end if;

  if p_days is null or array_length(p_days, 1) is null then
    raise exception 'pick at least one day of the continuing course';
  end if;
  if exists (select 1 from unnest(p_days) d where not (d = any (coalesce(v_target.course_days, '{}')))) then
    raise exception 'every chosen day must be a day that course runs on';
  end if;

  -- Re-registering the same diver on the same course is the duplicate-sale
  -- mistake this feature exists to prevent, so it is refused outright.
  if exists (
    select 1 from public.bookings
     where user_id = v_source.user_id
       and event_id = p_event_id
       and status <> 'cancelled'
  ) then
    raise exception 'this diver is already booked on that course';
  end if;

  if p_source_days is not null then
    if array_length(p_source_days, 1) is null then
      raise exception 'the original booking must keep at least one day';
    end if;
    if exists (select 1 from unnest(p_source_days) d
                where not (d = any (coalesce(v_source_event.course_days, '{}')))) then
      raise exception 'every original day must be a day that course runs on';
    end if;
    update public.bookings
       set attend_days = p_source_days
     where id = p_source_booking;
  end if;

  -- Gear carries over — the student wears the same wetsuit on the days they
  -- finish as on the days they started, and the day-level packing views read it
  -- off the booking they find on that day.
  --
  -- Money does not. The charge snapshot is one explicit zero line rather than
  -- an empty array: resolveCharges() treats an empty `charges` as "this booking
  -- predates the snapshot" and rebuilds the breakdown from current catalog
  -- prices, which would show this diver a full second course fee (reconciled
  -- back to zero by an adjustment line, but shown all the same). One stated
  -- line says what is true — nothing is owed here — and nothing recomputes it.
  v_details := jsonb_strip_nulls(jsonb_build_object(
    'gear',                v_source.details -> 'gear',
    'total',               0,
    'deposit',             0,
    'charges',             jsonb_build_array(jsonb_build_object(
      'kind',   'adjustment',
      'label',  coalesce(nullif(btrim(p_charge_label), ''), 'No charge — paid on the original booking'),
      'amount', 0
    )),
    'course_continuation', true
  ));

  insert into public.bookings (user_id, event_id, status, details, continues_booking_id, attend_days)
  values (v_source.user_id, p_event_id, 'confirmed', v_details, p_source_booking, p_days)
  returning id into v_new_id;

  return v_new_id;
end;
$$;

alter function public.create_course_continuation(uuid, uuid, date[], date[], text) owner to postgres;

revoke all on function public.create_course_continuation(uuid, uuid, date[], date[], text) from public;
grant execute on function public.create_course_continuation(uuid, uuid, date[], date[], text) to authenticated;
