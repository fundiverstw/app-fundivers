-- Privacy: a staff_busy entry's title + details are the owner's
-- personal context (vacation reason, medical appointment, etc.) and
-- shouldn't leak to other staff or admins peeking at the overlay. They
-- still need to know the period is blocked and whose period it is, so
-- the view exposes the date range + owner's display name, but masks
-- title/details for non-owners.
--
-- security_invoker = on so the table's existing RLS still gates which
-- rows the caller can see (own rows for staff; all rows for admin).

begin;

create or replace view public.staff_availability_view
with (security_invoker = on) as
select
  sa.id,
  sa.user_id,
  sa.start_date,
  sa.start_time,
  sa.end_date,
  case when sa.user_id = auth.uid() then sa.title   else null end as title,
  case when sa.user_id = auth.uid() then sa.details else null end as details,
  coalesce(p.display_name, p.full_name) as owner_display_name,
  sa.created_at,
  sa.updated_at
from public.staff_availability sa
left join public.profiles p on p.id = sa.user_id;

grant select on public.staff_availability_view to authenticated;

commit;
