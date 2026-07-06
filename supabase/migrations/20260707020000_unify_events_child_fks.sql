-- Stage 2 (expand) — add event_id to the child tables and backfill it from the
-- existing eo_dive_id/eo_course_id via events.legacy_id. ADDITIVE: the old eo_*
-- columns + their FKs stay in place (so anything still reading them works); the
-- contract stage drops them and makes event_id NOT NULL.

begin;

do $$
declare t text;
begin
  foreach t in array array['admin_notes','bookings','duties','event_vehicles','event_waivers','waiver_signatures']
  loop
    execute format('alter table public.%I add column if not exists event_id uuid', t);
    execute format(
      'update public.%I c set event_id = e.id from public.events e
         where e.legacy_id = coalesce(c.eo_dive_id, c.eo_course_id) and c.event_id is null', t);
    begin
      execute format(
        'alter table public.%I add constraint %I foreign key (event_id)
           references public.events(id) on delete cascade', t, t || '_event_id_fkey');
    exception when duplicate_object then null;
    end;
    execute format('create index if not exists %I on public.%I (event_id)', t || '_event_id_idx', t);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
