-- C3 — move the Wix sync webhook token out of pg_trigger.tgargs and
-- into Supabase Vault. The previous triggers in
-- 20260430153210_remote_schema.sql inlined the secret as a literal
-- string in `CREATE TRIGGER ... EXECUTE FUNCTION http_request(...,
-- '{"...","x-sync-token":"<hex>"}', ...)`. That literal:
--   * sits in every clone / dump / backup of the repo;
--   * sits readable in pg_trigger.tgargs to any role with SELECT on the
--     catalog (and to PostgREST under default permissions);
--   * had no rotation mechanism.
--
-- New shape:
--   1. The token lives in `vault.secrets` under name `wix_sync_token`.
--      It's created out-of-band via Studio SQL editor BEFORE this
--      migration is pushed:
--        select vault.create_secret('<token>', 'wix_sync_token');
--      If the secret is missing at trigger fire time, the helper logs
--      a warning and skips — preferable to crashing every admin
--      catalog write.
--   2. A SECURITY DEFINER trigger function `public.wix_sync_notify()`
--      reads the live token from `vault.decrypted_secrets` and POSTs
--      the standard Supabase database-webhook payload to the Velo
--      receiver via pg_net's `net.http_post`. Payload shape mirrors
--      what supabase_functions.http_request emits so the Wix handler
--      (wix/backend/http-functions.js → post_supabaseWebhook) keeps
--      working unchanged.
--   3. The 8 existing triggers (wix_sync_dive_travel and friends) are
--      dropped and recreated against the new function. Same names so
--      `supabase/seeds/disable-wix-triggers.sql` keeps stripping them
--      cleanly on local.
--
-- Rotation procedure going forward:
--   * Update wixSecretsBackend value in Wix Secrets Manager.
--   * `select vault.update_secret(id, '<new-token>')` in Supabase.
--   * No migration / deploy needed; helper reads live on every call.

begin;

-- ============================================================
-- 1. Trigger helper — reads vault token, fires the webhook
-- ============================================================

create or replace function public.wix_sync_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tok       text;
  payload   jsonb;
begin
  select decrypted_secret into tok
    from vault.decrypted_secrets
   where name = 'wix_sync_token'
   limit 1;

  if tok is null then
    raise warning 'wix_sync_token missing from vault; skipping Wix sync for %.% (tg_op=%)',
      tg_table_schema, tg_table_name, tg_op;
    return coalesce(new, old);
  end if;

  -- Mirrors the Supabase database-webhook payload shape that
  -- supabase_functions.http_request produced. wix/backend/
  -- http-functions.js → post_supabaseWebhook reads
  -- type / table / record / old_record off this body.
  payload := jsonb_build_object(
    'type',       tg_op,
    'table',      tg_table_name,
    'schema',     tg_table_schema,
    'record',     case when tg_op <> 'DELETE' then to_jsonb(new) end,
    'old_record', case when tg_op <> 'INSERT' then to_jsonb(old) end
  );

  perform net.http_post(
    url := 'https://fundiverstw.com/_functions/supabaseWebhook',
    body := payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-token', tok
    ),
    timeout_milliseconds := 5000
  );

  return coalesce(new, old);
end;
$$;

revoke all on function public.wix_sync_notify() from public;

-- ============================================================
-- 2. Drop old triggers (with the inlined token)
-- ============================================================

drop trigger if exists wix_sync_dive_travel           on public."DiveTravel";
drop trigger if exists wix_sync_eo_courses            on public."EO_courses";
drop trigger if exists wix_sync_eo_dives              on public."EO_dives";
drop trigger if exists wix_sync_eo_prices             on public."EO_prices";
drop trigger if exists wix_sync_eo_rooms              on public."EO_rooms";
drop trigger if exists wix_sync_other_addons          on public."Other_Addons";
drop trigger if exists wix_sync_cancellation_policies on public.cancellation_policies;
drop trigger if exists wix_sync_cert_levels           on public.cert_levels;

-- ============================================================
-- 3. Recreate triggers against the vault-backed helper
-- ============================================================

create trigger wix_sync_dive_travel
  after insert or update or delete on public."DiveTravel"
  for each row execute function public.wix_sync_notify();

create trigger wix_sync_eo_courses
  after insert or update or delete on public."EO_courses"
  for each row execute function public.wix_sync_notify();

create trigger wix_sync_eo_dives
  after insert or update or delete on public."EO_dives"
  for each row execute function public.wix_sync_notify();

create trigger wix_sync_eo_prices
  after insert or update or delete on public."EO_prices"
  for each row execute function public.wix_sync_notify();

create trigger wix_sync_eo_rooms
  after insert or update or delete on public."EO_rooms"
  for each row execute function public.wix_sync_notify();

create trigger wix_sync_other_addons
  after insert or update or delete on public."Other_Addons"
  for each row execute function public.wix_sync_notify();

create trigger wix_sync_cancellation_policies
  after insert or update or delete on public.cancellation_policies
  for each row execute function public.wix_sync_notify();

create trigger wix_sync_cert_levels
  after insert or update or delete on public.cert_levels
  for each row execute function public.wix_sync_notify();

commit;
