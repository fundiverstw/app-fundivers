-- Complete the Wix push: the two tables that were never syncing, plus a
-- push-based full sync.
--
-- The baseline installed public.wix_sync_notify() (POSTs a changed row to the
-- Wix webhook, gated on the vault 'wix_sync_token' secret) with triggers on the
-- catalog reference tables and the event junctions -- but NOT on `events` itself
-- or on `travel_destinations`. So edits to a dive/course's own fields, and any
-- change to the destination catalog, never reached Wix. Add both triggers.
--
-- The triggers only emit *changes*, so a row that already exists and never
-- changes is never sent. public.wix_sync_all() re-emits every current row of the
-- synced tables through the SAME webhook -- the identical payload a trigger
-- sends, one POST per row -- so Wix reconciles without ever pulling from the
-- database. Reference tables are emitted before `events` so an event's catalog
-- references already exist on Wix when it lands; junctions are not emitted
-- separately (the event upsert re-attaches its own rooms/add-ons/destinations).

create or replace trigger wix_sync_events
  after insert or delete or update on public.events
  for each row execute function public.wix_sync_notify();

create or replace trigger wix_sync_travel_destinations
  after insert or delete or update on public.travel_destinations
  for each row execute function public.wix_sync_notify();

create or replace function public.wix_sync_all(p_table text default null)
    returns jsonb
    language plpgsql security definer set search_path to 'public'
    as $$
declare
  tok     text;
  tables  text[] := array[
    'prices', 'rooms', 'addons', 'trip_templates',
    'cancellation_policies', 'cert_levels', 'travel_destinations', 'events'
  ];
  tname   text;
  r       record;
  n       integer;
  counts  jsonb := '{}'::jsonb;
begin
  select decrypted_secret into tok
    from vault.decrypted_secrets where name = 'wix_sync_token' limit 1;
  if tok is null then
    raise exception 'wix_sync_all: the wix_sync_token vault secret is not set';
  end if;

  if p_table is not null then
    if not (p_table = any(tables)) then
      raise exception 'wix_sync_all: % is not a synced collection (allowed: %)',
        p_table, array_to_string(tables, ', ');
    end if;
    tables := array[p_table];
  end if;

  foreach tname in array tables loop
    n := 0;
    for r in execute format('select to_jsonb(t) as row from public.%I t', tname) loop
      perform net.http_post(
        url := 'https://fundiverstw.com/_functions/supabaseWebhook',
        body := jsonb_build_object(
          'type',       'UPDATE',
          'table',      tname,
          'schema',     'public',
          'record',     r.row,
          'old_record', null
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-sync-token', tok
        ),
        timeout_milliseconds := 5000
      );
      n := n + 1;
    end loop;
    counts := counts || jsonb_build_object(tname, n);
  end loop;

  return counts;
end;
$$;

alter function public.wix_sync_all(text) owner to postgres;
-- Supabase's default privileges grant EXECUTE to anon/authenticated on new
-- functions; strip those so only the service role (and postgres) can fire it.
revoke all on function public.wix_sync_all(text) from public, anon, authenticated;
grant execute on function public.wix_sync_all(text) to service_role;
