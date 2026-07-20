-- One-time repair for offers stranded by the phantom-pre-registration bug.
--
-- 20260720030000 stops a cancelled event handing out waitlist spots, but its
-- trigger only fires on the cancel *transition*. Any offer that was already
-- pending against an event cancelled before that migration ran stays pending
-- indefinitely — the diver keeps looking at a live invitation to an event that
-- is not happening, and (before the accept guard) could still act on it.
--
-- Expiring them is safe and is what the trigger would have done: the event is
-- cancelled, so the spot does not exist. Written as a plain UPDATE rather than
-- a trigger because it is a one-off repair of history.
--
-- Deliberately NOT repaired here, because neither is the database's call:
--
--   * Bookings already promoted off the waitlist onto a cancelled event (the
--     phantom pre-registrations themselves). Cancelling someone's booking
--     automatically could undo an arrangement the shop has since made with
--     them by hand. Find them with:
--
--       select b.id, b.user_id, b.status, e.admin_title, e.cancelled_at
--       from waitlist_offers o
--       join bookings b on b.id = o.booking_id
--       join events   e on e.id = b.event_id
--       where o.status = 'accepted'
--         and e.cancelled_at is not null
--         and o.offered_at > e.cancelled_at
--         and b.status <> 'cancelled';
--
--   * Bookings where 20260720020000's refund-netting bug left credit
--     under-applied. That self-heals the next time the diver applies credit;
--     moving their money for them is not something a migration should do.

update public.waitlist_offers o
   set status = 'expired'
  from public.bookings b
  join public.events e on e.id = b.event_id
 where b.id = o.booking_id
   and o.status = 'pending'
   and e.cancelled_at is not null;
