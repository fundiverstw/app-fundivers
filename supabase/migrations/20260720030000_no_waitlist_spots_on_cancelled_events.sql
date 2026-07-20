-- Stop the waitlist handing out spots on a cancelled event.
--
-- Cancelling an event sets events.cancelled_at and deliberately leaves the
-- bookings alone. But nothing in the waitlist machinery knew what a cancelled
-- event was, so this happened:
--
--   1. Admin cancels the event; divers are notified.
--   2. A diver does the obvious thing and cancels their booking on it.
--   3. handle_booking_cancellation fires offer_next_waitlist_spot, which
--      cheerfully promotes the next waitlisted diver.
--   4. That diver is told a spot opened up, accepts, and their booking flips
--      from 'waitlisted' to 'pending'.
--
-- The result is a pre-registration on a dead event that the diver never asked
-- for, appearing days after the cancellation — the "phantom pre-registration"
-- divers reported.
--
-- Three guards, because each covers a different moment:
--   * offer_next_waitlist_spot  — never create the offer (step 3).
--   * accept_waitlist_offer     — refuse offers already pending when the event
--                                 was cancelled (step 4).
--   * a trigger on events       — expire those pending offers at cancel time,
--                                 so nobody is left staring at a live-looking
--                                 invitation to an event that is not happening.

CREATE OR REPLACE FUNCTION public.offer_next_waitlist_spot(p_event_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_booking_id uuid;
  v_offer_id   uuid;
begin
  -- A cancelled event has no spots to give away. Without this, a diver
  -- cancelling their booking on an event that was just called off promoted the
  -- next person on the waitlist into it.
  if exists (select 1 from public.events e
             where e.id = p_event_id and e.cancelled_at is not null) then
    return null;
  end if;

  select b.id into v_booking_id
  from public.bookings b
  where b.status = 'waitlisted' and b.event_id = p_event_id
    and not exists (select 1 from public.waitlist_offers o where o.booking_id = b.id and o.status = 'pending')
  order by b.created_at asc
  limit 1;
  if v_booking_id is null then return null; end if;
  insert into public.waitlist_offers (booking_id) values (v_booking_id)
    on conflict (booking_id) where status = 'pending' do nothing
  returning id into v_offer_id;
  return v_offer_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.accept_waitlist_offer(p_offer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_booking_id uuid;
  v_user_id    uuid;
  v_status     text;
  v_expires_at timestamptz;
  v_event_id   uuid;
  v_capacity   int;
  v_taken      int;
begin
  select o.booking_id, b.user_id, o.status, o.expires_at, b.event_id
    into v_booking_id, v_user_id, v_status, v_expires_at, v_event_id
  from public.waitlist_offers o
  join public.bookings b on b.id = o.booking_id
  where o.id = p_offer_id;

  if v_booking_id is null then raise exception 'offer not found'; end if;
  if v_user_id is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_status <> 'pending' then raise exception 'offer is no longer pending (status=%)', v_status; end if;
  if v_expires_at < now() then raise exception 'offer has expired'; end if;

  -- Covers offers that were already pending when the event was called off.
  if exists (select 1 from public.events e
             where e.id = v_event_id and e.cancelled_at is not null) then
    raise exception 'event has been cancelled; this offer can no longer be accepted'
      using errcode = 'check_violation';
  end if;

  if v_event_id is not null then
    select capacity into v_capacity from public.events where id = v_event_id;
    select count(*) into v_taken from public.bookings
      where event_id = v_event_id and status in ('pending', 'confirmed');
  end if;
  if v_capacity is not null and v_taken >= v_capacity then
    raise exception 'event is at capacity (% of %); offer cannot be accepted', v_taken, v_capacity
      using errcode = 'check_violation';
  end if;

  update public.waitlist_offers set status = 'accepted' where id = p_offer_id;
  update public.bookings        set status = 'pending'  where id = v_booking_id;
end;
$function$;

-- Clean up offers that were already outstanding when the event was called off.
create or replace function public.expire_waitlist_offers_on_event_cancel()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.cancelled_at is not null and old.cancelled_at is null then
    update public.waitlist_offers o
       set status = 'expired'
      from public.bookings b
     where b.id = o.booking_id
       and b.event_id = new.id
       and o.status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_events_expire_waitlist_offers on public.events;
create trigger trg_events_expire_waitlist_offers
  after update of cancelled_at on public.events
  for each row execute function public.expire_waitlist_offers_on_event_cancel();
