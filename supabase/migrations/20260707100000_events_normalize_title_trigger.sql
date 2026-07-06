-- Converge (6/7): retarget the capacity display-title normalizer onto events.
-- The old trg_eo_dives/eo_courses_normalize_title triggers went away with
-- EO_dives/EO_courses; rewrite the shared trigger function to key on new.id
-- (via event_confirmed_count_one(new.id)) and attach it to events.

begin;

create or replace function public.eo_event_normalize_display_title() returns trigger
    language plpgsql
    as $$
declare
  v_base      text;
  v_confirmed int;
begin
  v_base := public.strip_capacity_suffix(new.display_title);
  v_confirmed := public.event_confirmed_count_one(new.id);
  new.display_title := v_base || public.capacity_suffix(
    new.capacity, coalesce(new.fully_booked, false), v_confirmed
  );
  return new;
end;
$$;

drop trigger if exists trg_events_normalize_title on public.events;
create trigger trg_events_normalize_title
  before insert or update on public.events
  for each row execute function public.eo_event_normalize_display_title();

commit;

notify pgrst, 'reload schema';
