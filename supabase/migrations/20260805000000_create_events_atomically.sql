-- One transaction for creating events, with or without a recurrence rule.
--
-- Creating a single event took three round trips from the browser (insert the
-- row, set_event_relations, insert the car allocations) and creating a series
-- took 2 + 2N. Any of them could fail on its own, leaving an event with no
-- rooms, a series whose later occurrences have no add-ons, or -- worst -- a
-- half-generated batch where some Saturdays are bookable and some are not. The
-- client could report that but not undo it.
--
-- A plpgsql function is one transaction, so everything below either lands or
-- none of it does.
--
-- SECURITY INVOKER (the default) on purpose: the existing "events admin insert"
-- and "event_series: admin insert" policies then do the authorisation, with no
-- second is_admin() gate here to drift out of step with them. A staff user
-- calling this gets the same rejection they would get inserting by hand.

create or replace function public.create_events_with_relations(
  -- Complete `events` rows as a JSON array. Each object's keys are column
  -- names; `id` is generated here so the caller cannot collide with an existing
  -- row. Per-occurrence date differences are already baked into each object by
  -- the caller (see shiftFormToDate in src/lib/event-series.ts).
  p_events          jsonb,
  p_room_ids        uuid[] default '{}',
  p_addon_ids       uuid[] default '{}',
  p_destination_ids uuid[] default '{}',
  -- Cars are assigned to every event in the batch: a weekly boat dive needs the
  -- van on each of its dates, not just the first.
  p_vehicle_ids     uuid[] default '{}',
  -- {label, kind, freq, interval, weekdays} to create a series and point every
  -- event at it. NULL creates one-off events with series_id left null.
  p_series          jsonb  default null,
  -- An EXISTING series to attach these events to, for extending a batch that
  -- already exists. Mutually exclusive with p_series.
  p_series_id       uuid   default null,
  p_created_by      uuid   default null
) returns uuid[]
  language plpgsql
  set search_path to 'public'
as $$
declare
  v_series_id uuid;
  v_event     jsonb;
  v_row       public.events;
  v_ids       uuid[] := '{}';
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a JSON array of event rows'
      using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(p_events) = 0 then
    raise exception 'p_events is empty' using errcode = 'invalid_parameter_value';
  end if;
  -- Mirrors MAX_OCCURRENCES in src/lib/recurrence.ts. The client caps the count
  -- too; this is the backstop that a modified client cannot talk past.
  if jsonb_array_length(p_events) > 52 then
    raise exception 'a batch may create at most 52 events (got %)', jsonb_array_length(p_events)
      using errcode = 'invalid_parameter_value';
  end if;

  if p_series is not null and p_series_id is not null then
    raise exception 'pass p_series to create a series or p_series_id to extend one, not both'
      using errcode = 'invalid_parameter_value';
  end if;

  v_series_id := p_series_id;

  if p_series is not null then
    insert into public.event_series (label, kind, freq, "interval", weekdays, created_by)
    values (
      nullif(btrim(coalesce(p_series ->> 'label', '')), ''),
      p_series ->> 'kind',
      p_series ->> 'freq',
      (p_series ->> 'interval')::integer,
      case
        when p_series ->> 'weekdays' is null then null
        else (select array_agg(value::smallint) from jsonb_array_elements_text(p_series -> 'weekdays'))
      end,
      p_created_by
    )
    returning id into v_series_id;
  end if;

  for v_event in select * from jsonb_array_elements(p_events)
  loop
    -- jsonb_populate_record maps JSON keys onto columns and leaves the rest
    -- NULL, which is why the caller sends a complete payload: a column with a
    -- DB default that is absent here lands as NULL, not as its default.
    v_row := jsonb_populate_record(null::public.events, v_event);
    v_row.id := gen_random_uuid();
    v_row.series_id := v_series_id;

    insert into public.events select v_row.*;
    v_ids := v_ids || v_row.id;

    insert into public.event_rooms (event_id, room_id)
      select v_row.id, unnest(p_room_ids) on conflict do nothing;
    insert into public.event_addons (event_id, addon_id)
      select v_row.id, unnest(p_addon_ids) on conflict do nothing;
    insert into public.event_destinations (event_id, destination_id)
      select v_row.id, unnest(p_destination_ids) on conflict do nothing;
    insert into public.event_vehicles (event_id, vehicle_id, created_by)
      select v_row.id, unnest(p_vehicle_ids), p_created_by on conflict do nothing;
  end loop;

  return v_ids;
end;
$$;

comment on function public.create_events_with_relations(jsonb, uuid[], uuid[], uuid[], uuid[], jsonb, uuid, uuid) is
  'Creates one or many events plus their junction rows (and optionally a recurrence series) in a single transaction. SECURITY INVOKER: the events/event_series RLS policies authorise the caller.';

alter function public.create_events_with_relations(jsonb, uuid[], uuid[], uuid[], uuid[], jsonb, uuid, uuid)
  owner to postgres;
revoke all on function public.create_events_with_relations(jsonb, uuid[], uuid[], uuid[], uuid[], jsonb, uuid, uuid)
  from public, anon;
-- authenticated for the admin UI, service_role for the backend and the
-- integration suite. anon stays revoked: it is SECURITY INVOKER, so an anon
-- caller would fail the RLS check anyway, and there is no reason to let one try.
grant execute on function public.create_events_with_relations(jsonb, uuid[], uuid[], uuid[], uuid[], jsonb, uuid, uuid)
  to authenticated, service_role;
