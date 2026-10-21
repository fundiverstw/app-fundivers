-- Non-diver options: a way to register for a dive without diving.
--
-- A partner who snorkels while the group dives, a friend who rides the boat --
-- they come on the trip, they take a seat and a lunch, and the shop charges
-- them something other than the diver fee. Until now the only way to book one
-- was as a diver at the diver price and an amendment afterwards.
--
-- Same two-table shape as discounts (20260912100000):
--
--   nondiver_options        what the shop offers at all (a catalog row: the
--                           name divers see, its own fee, its own deposit)
--   event_nondiver_options  which of them THIS event puts on the register form
--
-- The choice itself is not a table. Like the room a diver picks, it lives in
-- the booking's details (details.nondiver_option = { id, label }), where the
-- frozen total and charge lines that follow from it already live. The
-- registration edge function re-reads the option and its price server-side, so
-- a crafted request can name an option but never its fee.

-- ── 1. nondiver_options: the shop's catalog ─────────────────────────────────
create table public.nondiver_options (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  -- Shop-authored and diver-facing ("Snorkeler", "Boat passenger"). Never
  -- translated, like every other shop-authored label.
  label text not null,
  -- What the option covers, shown beside it on the register form.
  description text,
  -- The fee a non-diver pays in place of the event's diver price. Whole units,
  -- like every other catalog price.
  price integer not null,
  -- Due to secure the spot. Null means none: the non-diver pays in full.
  deposit_amount integer,
  active boolean not null default true,
  sort_order integer not null default 0,
  constraint nondiver_options_label_check check (char_length(btrim(label)) between 1 and 120),
  constraint nondiver_options_description_check check (description is null or char_length(description) <= 1000),
  constraint nondiver_options_price_check check (price >= 0),
  constraint nondiver_options_deposit_check check (deposit_amount is null or deposit_amount > 0)
);
create index nondiver_options_active_idx on public.nondiver_options using btree (active) where (active);

alter table public.nondiver_options enable row level security;
-- Diver-readable reference data, exactly like discounts: the register form has
-- to render the options, and a guest booking reaches it before they have an
-- account.
create policy "nondiver_options: public select" on public.nondiver_options
  for select to authenticated, anon using (true);
create policy "nondiver_options: admin insert" on public.nondiver_options
  for insert to authenticated with check (public.is_admin());
create policy "nondiver_options: admin update" on public.nondiver_options
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "nondiver_options: admin delete" on public.nondiver_options
  for delete to authenticated using (public.is_admin());

grant select on public.nondiver_options to anon, authenticated;
grant insert, update, delete on public.nondiver_options to authenticated;
grant all on public.nondiver_options to service_role;

-- ── 2. event_nondiver_options: what one event offers ────────────────────────
create table public.event_nondiver_options (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  event_id uuid not null references public.events(id) on delete cascade,
  -- Cascaded: deleting an option withdraws it from every event. Bookings that
  -- chose it keep their snapshot ({ id, label } and the frozen charges).
  option_id uuid not null references public.nondiver_options(id) on delete cascade
);
create unique index event_nondiver_options_event_option_uniq
  on public.event_nondiver_options using btree (event_id, option_id);
create index event_nondiver_options_event_idx
  on public.event_nondiver_options using btree (event_id);

alter table public.event_nondiver_options enable row level security;
create policy "event_nondiver_options: public select" on public.event_nondiver_options
  for select to authenticated, anon using (true);
create policy "event_nondiver_options: admin insert" on public.event_nondiver_options
  for insert to authenticated with check (public.is_admin());
create policy "event_nondiver_options: admin delete" on public.event_nondiver_options
  for delete to authenticated using (public.is_admin());

grant select on public.event_nondiver_options to anon, authenticated;
grant insert, delete on public.event_nondiver_options to authenticated;
grant all on public.event_nondiver_options to service_role;

-- ── 3. Options ride with the rest of an event's catalog relations ───────────
-- Both event-writing functions take the offered option ids alongside rooms,
-- add-ons, destinations and discounts, so an event created from the form
-- arrives with its options attached and an edit reconciles them in the same
-- transaction. Dropped and recreated rather than overloaded, for the same
-- reason as in 20260912100000: PostgREST refuses an ambiguous named call.
drop function if exists public.set_event_relations(uuid, uuid[], uuid[], uuid[], uuid[]);

create or replace function public.set_event_relations(
  p_event_id uuid,
  p_room_ids uuid[] default '{}',
  p_addon_ids uuid[] default '{}',
  p_destination_ids uuid[] default '{}',
  p_discount_ids uuid[] default '{}',
  p_nondiver_option_ids uuid[] default '{}'
) returns void
  language plpgsql
  set search_path to 'public'
as $$
begin
  delete from public.event_rooms where event_id = p_event_id;
  insert into public.event_rooms (event_id, room_id)
    select p_event_id, unnest(p_room_ids) on conflict do nothing;

  delete from public.event_addons where event_id = p_event_id;
  insert into public.event_addons (event_id, addon_id)
    select p_event_id, unnest(p_addon_ids) on conflict do nothing;

  delete from public.event_destinations where event_id = p_event_id;
  insert into public.event_destinations (event_id, destination_id)
    select p_event_id, unnest(p_destination_ids) on conflict do nothing;

  delete from public.event_discounts where event_id = p_event_id;
  insert into public.event_discounts (event_id, discount_id)
    select p_event_id, unnest(p_discount_ids) on conflict do nothing;

  delete from public.event_nondiver_options where event_id = p_event_id;
  insert into public.event_nondiver_options (event_id, option_id)
    select p_event_id, unnest(p_nondiver_option_ids) on conflict do nothing;
end;
$$;

alter function public.set_event_relations(uuid, uuid[], uuid[], uuid[], uuid[], uuid[]) owner to postgres;
revoke all on function public.set_event_relations(uuid, uuid[], uuid[], uuid[], uuid[], uuid[]) from public;
grant execute on function public.set_event_relations(uuid, uuid[], uuid[], uuid[], uuid[], uuid[])
  to anon, authenticated, service_role;

drop function if exists public.create_events_with_relations(jsonb, uuid[], uuid[], uuid[], uuid[], jsonb, uuid, uuid, uuid[]);

create or replace function public.create_events_with_relations(
  p_events              jsonb,
  p_room_ids            uuid[] default '{}',
  p_addon_ids           uuid[] default '{}',
  p_destination_ids     uuid[] default '{}',
  p_vehicle_ids         uuid[] default '{}',
  p_series              jsonb  default null,
  p_series_id           uuid   default null,
  p_created_by          uuid   default null,
  p_discount_ids        uuid[] default '{}',
  p_nondiver_option_ids uuid[] default '{}'
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
    insert into public.event_discounts (event_id, discount_id, created_by)
      select v_row.id, unnest(p_discount_ids), p_created_by on conflict do nothing;
    insert into public.event_nondiver_options (event_id, option_id, created_by)
      select v_row.id, unnest(p_nondiver_option_ids), p_created_by on conflict do nothing;
  end loop;

  return v_ids;
end;
$$;

comment on function public.create_events_with_relations(jsonb, uuid[], uuid[], uuid[], uuid[], jsonb, uuid, uuid, uuid[], uuid[]) is
  'Creates one or many events plus their junction rows (and optionally a recurrence series) in a single transaction. SECURITY INVOKER: the events/event_series RLS policies authorise the caller.';

alter function public.create_events_with_relations(jsonb, uuid[], uuid[], uuid[], uuid[], jsonb, uuid, uuid, uuid[], uuid[])
  owner to postgres;
revoke all on function public.create_events_with_relations(jsonb, uuid[], uuid[], uuid[], uuid[], jsonb, uuid, uuid, uuid[], uuid[])
  from public, anon;
grant execute on function public.create_events_with_relations(jsonb, uuid[], uuid[], uuid[], uuid[], jsonb, uuid, uuid, uuid[], uuid[])
  to authenticated, service_role;

comment on table public.nondiver_options is
  'Shop-authored non-diver options (e.g. snorkeler, boat passenger), each with its own fee and optional deposit. Offered per event via event_nondiver_options; the choice is stored on the booking as details.nondiver_option.';
comment on table public.event_nondiver_options is
  'Which non-diver options an event offers on its register form.';
