-- Discounts: shop-authored, offered per event, requested by the diver,
-- approved by an admin.
--
-- Three tables, because the same discount means three different things at
-- three moments:
--
--   discounts         what the shop offers at all (a catalog row, like
--                     waivers or payment methods -- shop data, not code)
--   event_discounts   which of them THIS event puts on the register form
--   booking_discounts one diver asking for one of them on one booking, and
--                     what an admin decided about it
--
-- The money is deliberately NOT here. An approved discount writes a negative
-- `booking_amendments` row, which is the one ledger every balance in the app
-- already reads (`owed = details.total + sum(amendments)`), so the event
-- balance, the diver's statement, the deposit clamp, the refund queue and the
-- accounting export all pick it up with no new arithmetic. A discount that
-- edited `details.total` instead would silently rewrite the quote the diver
-- accepted at booking time, which is the one thing that snapshot exists to
-- prevent.
--
-- Nothing is applied until an admin approves. A request is a request: it
-- changes no figure, and the diver is told so on the register form.

-- ── 1. discounts: the shop's catalog ────────────────────────────────────────
create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  -- Shop-authored and diver-facing, in the shop's own words. Never translated,
  -- like every other shop-authored label (waiver titles, payment methods).
  label text not null,
  -- Who qualifies, shown beside the checkbox at registration.
  description text,
  -- 'percent' takes a share of the booking's frozen total; 'fixed' takes a
  -- flat amount in the shop currency. Integers both ways: booking_amendments
  -- stores whole units, so a fractional discount could not be recorded
  -- faithfully anyway.
  kind text not null,
  value integer not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  constraint discounts_kind_check check (kind = any (array['percent'::text, 'fixed'::text])),
  constraint discounts_label_check check (char_length(btrim(label)) between 1 and 120),
  constraint discounts_description_check check (description is null or char_length(description) <= 1000),
  constraint discounts_value_check check (
    (kind = 'percent' and value between 1 and 100)
    or (kind = 'fixed' and value > 0)
  )
);
create index discounts_active_idx on public.discounts using btree (active) where (active);

alter table public.discounts enable row level security;
-- Diver-readable reference data, exactly like waivers and cancellation
-- policies: the register form has to render the offer, and a guest booking
-- reaches it before they have an account.
create policy "discounts: public select" on public.discounts
  for select to authenticated, anon using (true);
create policy "discounts: admin insert" on public.discounts
  for insert to authenticated with check (public.is_admin());
create policy "discounts: admin update" on public.discounts
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "discounts: admin delete" on public.discounts
  for delete to authenticated using (public.is_admin());

grant select on public.discounts to anon, authenticated;
grant insert, update, delete on public.discounts to authenticated;
grant all on public.discounts to service_role;

-- ── 2. event_discounts: what one event offers ───────────────────────────────
create table public.event_discounts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  event_id uuid not null references public.events(id) on delete cascade,
  discount_id uuid not null references public.discounts(id) on delete cascade
);
create unique index event_discounts_event_discount_uniq
  on public.event_discounts using btree (event_id, discount_id);
create index event_discounts_event_idx on public.event_discounts using btree (event_id);

alter table public.event_discounts enable row level security;
create policy "event_discounts: public select" on public.event_discounts
  for select to authenticated, anon using (true);
create policy "event_discounts: admin insert" on public.event_discounts
  for insert to authenticated with check (public.is_admin());
create policy "event_discounts: admin delete" on public.event_discounts
  for delete to authenticated using (public.is_admin());

grant select on public.event_discounts to anon, authenticated;
grant insert, delete on public.event_discounts to authenticated;
grant all on public.event_discounts to service_role;

-- ── 3. booking_discounts: one diver asking, one admin deciding ──────────────
create table public.booking_discounts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  -- Restricted, not cascaded: a request is money history once approved, and
  -- deleting the catalog row must not quietly erase the reason a diver paid
  -- less. Retire a discount with `active = false` instead.
  discount_id uuid not null references public.discounts(id) on delete restrict,
  status text not null default 'requested',
  -- Why the diver thinks they qualify, or why the admin decided as they did.
  note text,
  requested_at timestamptz not null default now(),
  requested_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  -- Stamped at approval: what actually came off, after the percent was taken
  -- and the result clamped to what was still owed.
  amount integer,
  amendment_id uuid references public.booking_amendments(id) on delete set null,
  constraint booking_discounts_status_check
    check (status = any (array['requested'::text, 'approved'::text, 'rejected'::text])),
  constraint booking_discounts_note_check check (note is null or char_length(note) <= 1000),
  -- An approved row names its money; anything else has none to name. Without
  -- this an 'approved' row with a null amendment_id would read as a discount
  -- the diver was granted and never received.
  constraint booking_discounts_money_matches_status check (
    (status = 'approved' and amount is not null and amount > 0 and amendment_id is not null)
    or (status <> 'approved' and amount is null and amendment_id is null)
  ),
  constraint booking_discounts_decision_stamped check (
    (status = 'requested' and decided_at is null)
    or (status <> 'requested' and decided_at is not null)
  )
);
-- One live request per discount per booking. A rejected one may be asked again
-- (the diver produces the student card they were missing); an outstanding or
-- granted one may not be duplicated.
create unique index booking_discounts_live_uniq
  on public.booking_discounts using btree (booking_id, discount_id)
  where (status <> 'rejected');
create index booking_discounts_booking_idx
  on public.booking_discounts using btree (booking_id);
create index booking_discounts_open_idx
  on public.booking_discounts using btree (requested_at)
  where (status = 'requested');

alter table public.booking_discounts enable row level security;
-- Readable by the diver whose booking it is, by the parent who manages them,
-- and by staff. Writes have no policy at all: every one goes through the two
-- RPCs below (or service_role, for the registration edge function), so no
-- client can mint an approval.
create policy "booking_discounts: diver select own" on public.booking_discounts
  for select to authenticated using (exists (
    select 1 from public.bookings b
    join public.profiles p on p.id = b.user_id
    where b.id = booking_discounts.booking_id
      and (b.user_id = auth.uid() or p.parent_account = auth.uid())
  ));
create policy "booking_discounts: staff_or_admin select" on public.booking_discounts
  for select to authenticated using (public.is_staff_or_admin());

grant select on public.booking_discounts to authenticated;
grant all on public.booking_discounts to service_role;

-- Same forensic trail the rest of the money tables got in 20260827400000: an
-- approval moves money, and "who granted this and when" must outlive the row.
create or replace trigger booking_discounts_admin_audit_trg
  after insert or delete or update on public.booking_discounts
  for each row execute function public.audit_admin_write();

-- ── 4. What a request is allowed to be ──────────────────────────────────────
-- One guard for both write paths -- the RPC a diver or admin calls, and the
-- service_role insert the registration edge function makes -- so neither can
-- create a request the other would have refused.
create or replace function public.booking_discounts_validate()
returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_booking  public.bookings%rowtype;
  v_discount public.discounts%rowtype;
begin
  select * into v_booking from public.bookings where id = new.booking_id;
  if not found then
    raise exception 'booking not found' using errcode = 'no_data_found';
  end if;
  if v_booking.status = 'cancelled' then
    raise exception 'cannot discount a cancelled booking' using errcode = 'check_violation';
  end if;

  select * into v_discount from public.discounts where id = new.discount_id;
  if not found then
    raise exception 'discount not found' using errcode = 'no_data_found';
  end if;
  if not v_discount.active then
    raise exception 'that discount is no longer offered' using errcode = 'check_violation';
  end if;

  -- A diver may only ask for what the event actually offers. An admin may
  -- apply any active discount to any booking -- that is the post-registration
  -- path, and requiring them to attach it to the event first would mean
  -- changing what every other diver on that event is offered just to reach
  -- one of them.
  if not public.is_admin() and not exists (
    select 1 from public.event_discounts ed
    where ed.event_id = v_booking.event_id and ed.discount_id = new.discount_id
  ) then
    raise exception 'that discount is not offered on this event' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

alter function public.booking_discounts_validate() owner to postgres;

create or replace trigger booking_discounts_validate_trg
  before insert on public.booking_discounts
  for each row execute function public.booking_discounts_validate();

-- ── 5. Telling the admins ───────────────────────────────────────────────────
-- Same shape as notify_admins_ride_waitlist: a diver has asked for something
-- only an admin can grant, so the inbox row is written by the database rather
-- than by whichever client happened to make the request. A request made from
-- the register form, from the admin UI, or by the registration edge function
-- all reach the same inbox.
create or replace function public.notify_admins_discount_request()
returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_title  text;
  v_diver  text;
  v_label  text;
  v_body   text;
  v_event  uuid;
begin
  if new.status <> 'requested' then
    return new;
  end if;

  select b.event_id into v_event from public.bookings b where b.id = new.booking_id;
  -- nullif, not coalesce alone: the capacity-suffix trigger can leave
  -- display_title an empty string, and coalesce would then pick '' over a
  -- perfectly good admin_title and read as "requested it on ".
  select coalesce(nullif(btrim(display_title), ''), nullif(btrim(admin_title), ''))
  into v_title
  from public.events where id = v_event;
  select nullif(btrim(name), '') into v_diver
  from public.profiles p
  join public.bookings b on b.user_id = p.id
  where b.id = new.booking_id;
  select label into v_label from public.discounts where id = new.discount_id;

  v_body := coalesce(v_diver, 'A diver')
    || ' requested the ' || coalesce(v_label, 'discount')
    || ' discount on ' || coalesce(v_title, 'an event')
    || ' -- it applies to nothing until you approve it.';

  insert into public.notifications (user_id, title, body, url, kind, event_id)
  select p.id, 'Discount request', v_body, '/admin/discounts', 'discount_request', v_event::text
  from public.profiles p
  where p.role = 'admin';

  return new;
end;
$$;

alter function public.notify_admins_discount_request() owner to postgres;

create or replace trigger booking_discounts_notify_admins_trg
  after insert on public.booking_discounts
  for each row execute function public.notify_admins_discount_request();

-- ── 6. Asking ───────────────────────────────────────────────────────────────
create or replace function public.request_booking_discount(
  p_booking_id uuid,
  p_discount_id uuid,
  p_note text default null
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_caller  uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_id      uuid;
begin
  if v_caller is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'booking not found' using errcode = 'no_data_found';
  end if;

  -- The diver whose booking it is, the parent who manages them, or staff.
  -- Everything else the request has to satisfy is in the validate trigger, so
  -- this RPC and the edge function's service_role insert cannot drift apart.
  if not (
    v_booking.user_id = v_caller
    or exists (select 1 from public.profiles
               where id = v_booking.user_id and parent_account = v_caller)
    or public.is_staff_or_admin()
  ) then
    raise exception 'not your booking' using errcode = 'insufficient_privilege';
  end if;

  insert into public.booking_discounts (booking_id, discount_id, note, requested_by)
  values (p_booking_id, p_discount_id, nullif(btrim(p_note), ''), v_caller)
  returning id into v_id;

  return v_id;
end;
$$;

alter function public.request_booking_discount(uuid, uuid, text) owner to postgres;
revoke all on function public.request_booking_discount(uuid, uuid, text) from public, anon;
grant execute on function public.request_booking_discount(uuid, uuid, text)
  to authenticated, service_role;

-- ── 7. Deciding ─────────────────────────────────────────────────────────────
-- The only thing in the app that turns a discount into money. Admin-only, to
-- match the booking_amendments insert policy it writes through: a discount an
-- admin has not approved is worth nothing, which is the whole point of asking.
create or replace function public.decide_booking_discount(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
) returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_caller    uuid := auth.uid();
  v_req       public.booking_discounts%rowtype;
  v_booking   public.bookings%rowtype;
  v_discount  public.discounts%rowtype;
  v_event     text;
  v_base      numeric;
  v_owed      numeric;
  v_paid      numeric;
  v_deposit   numeric;
  v_amount    integer;
  v_amendment uuid;
  v_note      text;
begin
  if v_caller is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_admin() then
    raise exception 'only an admin can decide a discount request'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_req from public.booking_discounts where id = p_request_id for update;
  if not found then
    raise exception 'discount request not found' using errcode = 'no_data_found';
  end if;
  if v_req.status <> 'requested' then
    raise exception 'that discount request was already decided' using errcode = 'check_violation';
  end if;

  if not p_approve then
    update public.booking_discounts
    set status = 'rejected',
        decided_at = now(),
        decided_by = v_caller,
        note = coalesce(nullif(btrim(p_note), ''), note)
    where id = p_request_id;
    return 0;
  end if;

  select * into v_booking from public.bookings where id = v_req.booking_id;
  select * into v_discount from public.discounts where id = v_req.discount_id;

  -- A cancelled booking has no live balance (see docs/payments.md): its frozen
  -- total is not a debt, so taking a discount off it would invent a credit out
  -- of a trip that is not happening.
  if v_booking.status = 'cancelled' then
    raise exception 'cannot discount a cancelled booking' using errcode = 'check_violation';
  end if;

  -- The percent is of the quote the diver accepted, not of what is left after
  -- other amendments: "10% off" means 10% of the trip, however much of it has
  -- since been paid or adjusted.
  v_base := coalesce((v_booking.details ->> 'total')::numeric, 0);
  v_owed := v_base + coalesce((select sum(amount) from public.booking_amendments
                               where booking_id = v_req.booking_id), 0);
  if v_owed <= 0 then
    raise exception 'this booking owes nothing to discount' using errcode = 'check_violation';
  end if;

  v_amount := case
    when v_discount.kind = 'percent' then round(v_base * v_discount.value / 100.0)
    else v_discount.value
  end;
  -- Clamped so a discount can settle a booking but never overshoot it into
  -- credit. Handing a diver money back is a credit row with a reason, decided
  -- deliberately -- not a rounding consequence of a 50%-off row meeting a
  -- balance that other amendments had already reduced.
  v_amount := least(v_amount, v_owed::integer);
  if v_amount <= 0 then
    raise exception 'this booking owes nothing to discount' using errcode = 'check_violation';
  end if;

  -- The note a diver reads on their own statement, so it is the shop's own
  -- wording for the discount rather than anything this function invents.
  v_note := v_discount.label
    || case when v_discount.kind = 'percent' then ' (' || v_discount.value || '%)' else '' end;

  insert into public.booking_amendments (booking_id, amount, note, created_by)
  values (v_req.booking_id, -v_amount, v_note, v_caller)
  returning id into v_amendment;

  update public.booking_discounts
  set status = 'approved',
      decided_at = now(),
      decided_by = v_caller,
      amount = v_amount,
      amendment_id = v_amendment,
      note = coalesce(nullif(btrim(p_note), ''), note)
  where id = p_request_id;

  -- A discount lowers what is owed, which can put an already-part-paid booking
  -- over its deposit for the first time. Same promotion rule as
  -- apply_credit_to_booking, against the deposit clamped to owed -- without it
  -- a diver whose discount settles their booking outright sits at 'pending'
  -- forever, holding a spot the shop thinks is unconfirmed.
  v_paid    := public.booking_net_paid(v_req.booking_id);
  v_deposit := coalesce((v_booking.details ->> 'deposit')::numeric, 0);
  if v_booking.status = 'pending' and v_paid >= least(v_deposit, v_owed - v_amount) then
    update public.bookings set status = 'confirmed' where id = v_req.booking_id;
  end if;

  v_event := v_booking.event_id::text;
  insert into public.notifications (user_id, title, body, url, kind, event_id)
  values (
    v_booking.user_id,
    'Discount approved',
    v_note || ' has been applied to your booking.',
    -- The diver's payments tab is nested under /records; a bare /payments
    -- falls through the router to the calendar.
    '/records/payments',
    'discount',
    v_event
  );

  return v_amount;
end;
$$;

alter function public.decide_booking_discount(uuid, boolean, text) owner to postgres;
revoke all on function public.decide_booking_discount(uuid, boolean, text) from public, anon;
grant execute on function public.decide_booking_discount(uuid, boolean, text)
  to authenticated, service_role;

-- ── 8. Discounts ride with the rest of an event's catalog relations ─────────
-- Both event-writing functions take the offered-discount ids alongside rooms,
-- add-ons and destinations, so an event created from the form arrives with its
-- discounts already attached and an edit reconciles them in the same
-- transaction as everything else. Dropped and recreated rather than overloaded:
-- a second signature reachable by the same named arguments is ambiguous, and
-- PostgREST would refuse the call.
drop function if exists public.set_event_relations(uuid, uuid[], uuid[], uuid[]);

create or replace function public.set_event_relations(
  p_event_id uuid,
  p_room_ids uuid[] default '{}',
  p_addon_ids uuid[] default '{}',
  p_destination_ids uuid[] default '{}',
  p_discount_ids uuid[] default '{}'
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
end;
$$;

alter function public.set_event_relations(uuid, uuid[], uuid[], uuid[], uuid[]) owner to postgres;
revoke all on function public.set_event_relations(uuid, uuid[], uuid[], uuid[], uuid[]) from public;
grant execute on function public.set_event_relations(uuid, uuid[], uuid[], uuid[], uuid[])
  to anon, authenticated, service_role;

drop function if exists public.create_events_with_relations(jsonb, uuid[], uuid[], uuid[], uuid[], jsonb, uuid, uuid);

create or replace function public.create_events_with_relations(
  p_events          jsonb,
  p_room_ids        uuid[] default '{}',
  p_addon_ids       uuid[] default '{}',
  p_destination_ids uuid[] default '{}',
  p_vehicle_ids     uuid[] default '{}',
  p_series          jsonb  default null,
  p_series_id       uuid   default null,
  p_created_by      uuid   default null,
  p_discount_ids    uuid[] default '{}'
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
  end loop;

  return v_ids;
end;
$$;

comment on function public.create_events_with_relations(jsonb, uuid[], uuid[], uuid[], uuid[], jsonb, uuid, uuid, uuid[]) is
  'Creates one or many events plus their junction rows (and optionally a recurrence series) in a single transaction. SECURITY INVOKER: the events/event_series RLS policies authorise the caller.';

alter function public.create_events_with_relations(jsonb, uuid[], uuid[], uuid[], uuid[], jsonb, uuid, uuid, uuid[])
  owner to postgres;
revoke all on function public.create_events_with_relations(jsonb, uuid[], uuid[], uuid[], uuid[], jsonb, uuid, uuid, uuid[])
  from public, anon;
grant execute on function public.create_events_with_relations(jsonb, uuid[], uuid[], uuid[], uuid[], jsonb, uuid, uuid, uuid[])
  to authenticated, service_role;

comment on table public.discounts is
  'Shop-authored discount catalog. Offered per event via event_discounts, requested per booking via booking_discounts, and worth nothing until an admin approves.';
comment on table public.event_discounts is
  'Which discounts an event offers on its register form.';
comment on table public.booking_discounts is
  'One diver asking for one discount on one booking. An approval writes the negative booking_amendments row that is the actual money.';
