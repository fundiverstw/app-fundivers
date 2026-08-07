-- Private events were readable by anyone holding the anon key.
--
-- `events public select` was `USING (true)` for anon + authenticated, so every
-- row of the table was public. The only thing hiding a private event was a
-- client-side query filter (`.eq('is_private', false)` in src/lib/events.ts),
-- which is a display convention, not an access control: PostgREST answers
--
--   GET /rest/v1/events?is_private=eq.true
--
-- with the anon key that ships in the public SPA bundle. Verified against the
-- local stack before writing this: as `anon`, a seeded private event returned
-- its title, dates and notes. A private charter is exactly the event whose
-- existence and customer-named title the shop does not publish.
--
-- Who legitimately reads a private event:
--   * staff and admins — they run it (the admin calendar, the duty roster);
--   * the diver booked onto it, and the parent of a booked child — it has to
--     appear on their bookings page and in their notifications.
-- Everyone else, signed in or not, gets the public catalogue only.
--
-- Two policies rather than one, split by role, so the anon path evaluates a
-- single boolean column and never needs EXECUTE on a SECURITY DEFINER helper.
-- Granting anon execute on definer functions is the exposure the sibling repo
-- had to claw back (revoke_anon_execute_on_privileged_rpcs); this shape avoids
-- creating that surface in the first place.
--
-- Cancelled events stay readable on purpose. A cancelled event was public
-- before it was cancelled, so hiding it protects nothing — and it must remain
-- visible to the divers who were booked on it, who are precisely the people
-- being told it is off.

-- Caller is booked on this event, or is the parent of a booked child.
--
-- SECURITY DEFINER so the answer does not depend on the caller's RLS view of
-- `bookings`. Inlining the EXISTS in the policy would have worked today —
-- bookings' own RLS already narrows the rows to the caller's — but it would
-- silently couple which events are visible to any future widening of the
-- bookings policies. A reader of this policy should not have to audit another
-- table's RLS to know what it grants.
create or replace function public.is_booked_on_event(p_event_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public'
as $$
  select exists (
    select 1
      from public.bookings b
      join public.profiles p on p.id = b.user_id
     where b.event_id = p_event_id
       and (b.user_id = auth.uid() or p.parent_account = auth.uid())
  );
$$;

alter function public.is_booked_on_event(uuid) owner to postgres;
revoke all on function public.is_booked_on_event(uuid) from public, anon;
grant execute on function public.is_booked_on_event(uuid) to authenticated;

comment on function public.is_booked_on_event(uuid) is
  'True when the caller (or a child they manage) has a booking on the event. Gates private-event visibility in the events select policies.';

drop policy if exists "events public select" on public.events;

-- Logged-out visitors: the public catalogue, nothing more.
create policy "events anon select" on public.events
  for select to anon
  using (is_private = false);

-- Signed-in: the public catalogue, plus private events they run or attend.
create policy "events authenticated select" on public.events
  for select to authenticated
  using (
    is_private = false
    or public.is_staff_or_admin()
    or public.is_booked_on_event(id)
  );
