-- Fix uuid/text type mismatch in waitlist helpers.
--
-- 20260507000000_waitlist_offers.sql declared offer_next_waitlist_spot with
-- text args and the cancellation trigger declared its locals as text. But
-- bookings.eo_dive_id / eo_course_id (and EO_dives._id / EO_courses._id)
-- are all uuid since 20260426000000_eo_uuid_ids.sql, so the comparison
-- inside the function raised "operator does not exist: uuid = text". That
-- error inside the AFTER UPDATE trigger aborted every cancel UPDATE,
-- which is why the bookings-one-active-per-event test started failing too
-- (the row never actually flipped to 'cancelled').
--
-- Forward-only fix per the migrations-are-immutable rule: drop and
-- recreate the function with uuid args, and rewrite the trigger function
-- with uuid locals.

begin;

drop function if exists public.offer_next_waitlist_spot(text, text);

create or replace function public.offer_next_waitlist_spot(
  p_event_id   uuid,
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

revoke execute on function public.offer_next_waitlist_spot(uuid, text) from public;
grant  execute on function public.offer_next_waitlist_spot(uuid, text) to service_role;


-- Cancellation trigger uses uuid locals so it can pass new.eo_dive_id /
-- eo_course_id straight through without a cast.
create or replace function public.handle_booking_cancellation()
returns trigger language plpgsql security definer as $$
declare
  v_event_id   uuid;
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

commit;
