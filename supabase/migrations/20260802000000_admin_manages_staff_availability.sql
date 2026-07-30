-- Admins manage everyone's duty availability.
--
-- staff_availability was strictly self-service: all three write policies
-- required user_id = auth.uid(), so an admin who learned a guide was away had
-- to ask that guide to enter it. Admins already had full SELECT on the base
-- table; only writes were owner-locked.
--
-- 1. Three admin-any write policies, added ALONGSIDE the owner ones rather
--    than replacing them. Permissive policies OR together, so staff
--    self-service keeps working exactly as before.
-- 2. staff_availability_view drops its title/details mask. It cannot fire any
--    more: "select own or admin" is the only way to reach a row, the owner was
--    already unmasked, and an admin who edits a colleague's entry has to see
--    the title it is about to save or the editor silently blanks it. Keeping
--    the CASE would only assert a boundary that no longer exists.
--
--    Row visibility is the privacy boundary here, not column masking. If the
--    SELECT policy is ever widened -- "every staff member can see who is away"
--    is a reasonable future feature -- put the mask back at the same time, so
--    colleagues learn that Ada is unavailable without reading why.
--
-- staff_availability_owner_role_trg still fires, so an admin cannot park
-- availability on a diver, and the duty-overlap trigger still rejects a duty
-- landing inside a window an admin has just created for someone.

create policy "staff_availability: admin insert any"
  on public.staff_availability for insert to authenticated
  with check (public.is_admin());

create policy "staff_availability: admin update any"
  on public.staff_availability for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "staff_availability: admin delete any"
  on public.staff_availability for delete to authenticated
  using (public.is_admin());

create or replace view public.staff_availability_view
  with (security_invoker = 'on') as
select
  sa.id,
  sa.user_id,
  sa.start_date,
  sa.start_time,
  sa.end_date,
  sa.title,
  sa.details,
  coalesce(p.nickname, p.name) as owner_display_name,
  sa.created_at,
  sa.updated_at
from public.staff_availability sa
  left join public.profiles p on p.id = sa.user_id;
