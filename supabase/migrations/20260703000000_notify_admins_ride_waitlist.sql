-- When a diver registers (or an admin edits a booking) opting into a shop ride
-- that has no free seat, the client stamps details.ride_waitlisted = true. This
-- trigger fans an in-app notification out to every admin so they know to add a
-- car on the logistics view or arrange transport. The ride booking itself
-- stands — this is a RIDE waitlist, independent of the event-capacity waitlist
-- carried on bookings.status.
--
-- Web push is not sent here (the Cloudflare push worker owns webpush and the DB
-- can't reach it); admins get the bell/inbox notification, which is the durable
-- record. A push relay can be layered on later via a worker endpoint.

begin;

create or replace function public.notify_admins_ride_waitlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id text;
  v_title    text;
  v_diver    text;
  v_body     text;
begin
  -- Only fire for a live booking that is (newly) a ride-waitlist request.
  if coalesce(new.details->>'ride_waitlisted', '') <> 'true' then
    return new;
  end if;
  if coalesce(new.status, '') = 'cancelled' then
    return new;
  end if;
  if tg_op = 'UPDATE' and coalesce(old.details->>'ride_waitlisted', '') = 'true' then
    return new;
  end if;

  v_event_id := coalesce(new.eo_dive_id, new.eo_course_id);

  if new.eo_dive_id is not null then
    select coalesce(display_title, admin_title) into v_title
    from public."EO_dives" where _id = new.eo_dive_id;
  else
    select coalesce(display_title, admin_title) into v_title
    from public."EO_courses" where _id = new.eo_course_id;
  end if;

  select nullif(trim(name), '') into v_diver
  from public.profiles where id = new.user_id;

  v_body := coalesce(v_diver, 'A diver')
    || ' requested a ride for ' || coalesce(v_title, 'an event')
    || ', but the shop ride is full — add a car or arrange transport.';

  insert into public.notifications (user_id, title, body, url, kind, event_id)
  select p.id, 'Ride waitlist request', v_body, '/admin/logistics', 'ride_waitlist', v_event_id
  from public.profiles p
  where p.role = 'admin';

  return new;
end;
$$;

drop trigger if exists notify_admins_ride_waitlist_trg on public.bookings;
create trigger notify_admins_ride_waitlist_trg
  after insert or update on public.bookings
  for each row execute function public.notify_admins_ride_waitlist();

commit;

notify pgrst, 'reload schema';
