-- Full-sync gap: wix_sync_all() (migration 20260711000000) never re-emitted the
-- event<->catalog junctions. Its comment claimed "the event upsert re-attaches
-- its own rooms/add-ons/destinations", but the `events` row carries no junction
-- data -- those relationships live ONLY in event_rooms / event_addons /
-- event_destinations. So while the AFTER-trigger path (migration 20260708100000)
-- propagates *live* junction edits, a push-based reconciliation left Wix with
-- events that had no rooms / add-ons / destinations attached.
--
-- Add the three junctions to the synced set, emitted AFTER `events` so the parent
-- event already exists on Wix when its junction rows arrive. Same webhook, same
-- per-row payload shape a trigger sends.

create or replace function public.wix_sync_all(p_table text default null)
    returns jsonb
    language plpgsql security definer set search_path to 'public'
    as $$
declare
  tok     text;
  tables  text[] := array[
    'prices', 'rooms', 'addons', 'trip_templates',
    'cancellation_policies', 'cert_levels', 'travel_destinations', 'events',
    'event_rooms', 'event_addons', 'event_destinations'
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
revoke all on function public.wix_sync_all(text) from public, anon, authenticated;
grant execute on function public.wix_sync_all(text) to service_role;
