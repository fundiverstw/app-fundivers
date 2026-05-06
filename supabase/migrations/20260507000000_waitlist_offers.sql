-- Waitlist machinery.
--
-- The status='waitlisted' enum value already exists on bookings but nothing
-- writes it. This migration ties it to the 'fully_booked' flag on events:
-- registrations against a fully-booked event land as waitlisted instead of
-- pending, and a cancellation on a fully-booked event opens an "offer round"
-- to the oldest waitlister with a 24-hour expiry. The push-cron worker
-- handles delivery and rolling expired offers to the next person in line.
--
-- Why a separate `waitlist_offers` table rather than columns on bookings:
-- a single waitlisted booking can receive multiple offers over time (one
-- per upstream cancellation), and we want each offer's 24-hour clock to be
-- independently tracked so the worker can expire and chain cleanly.

begin;

-- 1. Mirror EO_dives.fully_booked onto EO_courses so courses can also have
--    waitlists. Existing rows default to false (not full).
alter table public."EO_courses"
  add column if not exists fully_booked boolean default false;


-- 2. waitlist_offers — one row per "your spot just opened" round.
--
-- expires_at is offered_at + 24h. notified_at gets stamped by the worker
-- once push + email have been sent (so a worker that crashes mid-send
-- can re-deliver on the next tick without double-sending). status is
-- 'pending' (live) → 'accepted' (diver claimed) | 'expired' (24h passed).
create table public.waitlist_offers (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings(id) on delete cascade,
  offered_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '24 hours'),
  notified_at  timestamptz,
  status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'expired'))
);

create index waitlist_offers_status_expires_idx
  on public.waitlist_offers (status, expires_at);
create index waitlist_offers_booking_idx
  on public.waitlist_offers (booking_id);

-- One live offer per booking. Doubles as the race-condition guard: two
-- simultaneous cancellations on a fully-booked event can both try to
-- offer the same waitlister; the second insert hits the unique index
-- and the trigger function ON CONFLICT DO NOTHING swallows it.
create unique index waitlist_offers_one_pending_per_booking_idx
  on public.waitlist_offers (booking_id)
  where status = 'pending';

alter table public.waitlist_offers enable row level security;

-- A diver can read their own offers (the SPA needs this for the "Accept"
-- button + expires-at countdown). Writes are service-role only — both
-- the cancellation trigger and the worker bypass RLS.
create policy "waitlist_offers: own select"
  on public.waitlist_offers for select to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = waitlist_offers.booking_id and b.user_id = auth.uid()
    )
  );


-- 3. BEFORE INSERT trigger on bookings: if the linked event is
--    fully_booked AND the inserter sent the default status, flip to
--    'waitlisted'. Explicit confirmed/cancelled inserts (admin tooling
--    direct-write paths) pass through untouched.
create or replace function public.set_waitlisted_when_event_full()
returns trigger language plpgsql as $$
declare
  v_full boolean := false;
begin
  if new.status = 'pending' then
    if new.eo_dive_id is not null then
      select coalesce(fully_booked, false) into v_full
      from public."EO_dives" where _id = new.eo_dive_id;
    elsif new.eo_course_id is not null then
      select coalesce(fully_booked, false) into v_full
      from public."EO_courses" where _id = new.eo_course_id;
    end if;
    if v_full then
      new.status := 'waitlisted';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_bookings_set_waitlisted_when_full
  before insert on public.bookings
  for each row execute function public.set_waitlisted_when_event_full();


-- 4. Helper: offer the next available waitlist spot for an event.
--
-- "Next" = the oldest waitlisted booking on that event with no live
-- offer. Returns the new offer's id, or null when there's no eligible
-- waitlister (everyone already has a live offer, or the waitlist is
-- empty). ON CONFLICT DO NOTHING covers the concurrent-cancellation race.
create or replace function public.offer_next_waitlist_spot(
  p_event_id   text,
  p_event_type text
)
returns uuid language plpgsql security definer as $$
declare
  v_booking_id uuid;
  v_offer_id   uuid;
begin
  select b.id into v_booking_id
  from public.bookings b
  where b.status = 'waitlisted'
    and case when p_event_type = 'dive'
             then b.eo_dive_id    = p_event_id
             else b.eo_course_id  = p_event_id end
    and not exists (
      select 1 from public.waitlist_offers o
      where o.booking_id = b.id and o.status = 'pending'
    )
  order by b.created_at asc
  limit 1;

  if v_booking_id is null then
    return null;
  end if;

  insert into public.waitlist_offers (booking_id)
  values (v_booking_id)
  on conflict (booking_id) where status = 'pending' do nothing
  returning id into v_offer_id;

  return v_offer_id;
end;
$$;

revoke execute on function public.offer_next_waitlist_spot(text, text) from public;
grant  execute on function public.offer_next_waitlist_spot(text, text) to service_role;


-- 5. AFTER UPDATE trigger on bookings: when status -> 'cancelled'…
--      a) always: mark any live offer on this booking 'expired'
--         (covers a waitlisted diver opting out while holding an offer).
--      b) if the cancellation freed a real spot (OLD was pending or
--         confirmed): kick offer_next_waitlist_spot for this event.
create or replace function public.handle_booking_cancellation()
returns trigger language plpgsql security definer as $$
declare
  v_event_id   text;
  v_event_type text;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.waitlist_offers
       set status = 'expired'
     where booking_id = new.id and status = 'pending';

    if old.status in ('pending', 'confirmed') then
      v_event_id   := coalesce(new.eo_dive_id, new.eo_course_id);
      v_event_type := case when new.eo_dive_id is not null then 'dive' else 'course' end;
      perform public.offer_next_waitlist_spot(v_event_id, v_event_type);
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_bookings_cancellation_offer_next
  after update of status on public.bookings
  for each row execute function public.handle_booking_cancellation();


-- 6. Accept-offer RPC. The diver calls this from "Accept this spot" on
--    the bookings page. SECURITY DEFINER lets it touch waitlist_offers
--    (which has no client UPDATE policy) and bookings in one transaction;
--    the auth.uid() check inside the function gates it to the offer owner.
--    Validates the offer is still pending and unexpired before flipping
--    so a race against the worker's expire pass is impossible.
create or replace function public.accept_waitlist_offer(p_offer_id uuid)
returns void language plpgsql security definer as $$
declare
  v_booking_id uuid;
  v_user_id    uuid;
  v_status     text;
  v_expires_at timestamptz;
begin
  select o.booking_id, b.user_id, o.status, o.expires_at
    into v_booking_id, v_user_id, v_status, v_expires_at
  from public.waitlist_offers o
  join public.bookings b on b.id = o.booking_id
  where o.id = p_offer_id;

  if v_booking_id is null then
    raise exception 'offer not found';
  end if;
  if v_user_id is distinct from auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_status <> 'pending' then
    raise exception 'offer is no longer pending (status=%)', v_status;
  end if;
  if v_expires_at < now() then
    raise exception 'offer has expired';
  end if;

  update public.waitlist_offers set status = 'accepted' where id = p_offer_id;
  update public.bookings        set status = 'pending'  where id = v_booking_id;
end;
$$;

revoke execute on function public.accept_waitlist_offer(uuid) from public;
grant  execute on function public.accept_waitlist_offer(uuid) to authenticated;

commit;
