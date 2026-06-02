-- Legal-brief items #1 (L10) and #2: server-stamp consent timestamps
-- and version the agreement so a future terms-text change forces
-- re-acceptance.
--
-- What changes:
--   1. New column profiles.agreed_to_terms_version int.
--   2. Backfill version=1 for every profile that already has a
--      consent timestamp (they agreed to the text as it exists today;
--      that's the version we're calling 1 going forward).
--   3. handle_new_user rewritten to:
--      a. server-stamp agreed_to_terms_at = now() when the client
--         signals consent (presence of the key in raw_user_meta_data)
--         instead of trusting the client's ISO string. Closes
--         non-repudiation gap (audit L10).
--      b. record agreed_to_terms_version from metadata, default 1
--         when consent is signaled without a version. The SPA's
--         CURRENT_TERMS_VERSION constant drives what gets passed.
--      c. include `set search_path = public` (closes audit H3 for
--         this function; the other three are addressed separately).
--   4. New SECURITY DEFINER RPC accept_current_terms(int) for the
--      re-acceptance flow — server-stamps both columns so the SPA
--      can't drift back to a client-supplied timestamp.
--
-- Backwards compatible:
--   * SPA signup sends `agreed_to_terms_at` as it does today; trigger
--     now ignores the client's value and stamps now() instead. Net
--     effect: signup still records consent, but the timestamp is
--     trustworthy.
--   * Existing users keep working; the backfill seeds their version.

begin;

alter table public.profiles
  add column if not exists agreed_to_terms_version int;

update public.profiles
   set agreed_to_terms_version = 1
 where agreed_to_terms_at      is not null
   and agreed_to_terms_version is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  consented  bool := new.raw_user_meta_data ? 'agreed_to_terms_at';
  client_ver int  := nullif(new.raw_user_meta_data ->> 'agreed_to_terms_version', '')::int;
begin
  insert into public.profiles (id, agreed_to_terms_at, agreed_to_terms_version)
  values (
    new.id,
    case when consented then now() else null end,
    case when consented then coalesce(client_ver, 1) else null end
  );
  return new;
end;
$$;

-- Re-acceptance RPC. SPA calls this when the route guard detects a
-- stale agreed_to_terms_version. Server-stamps both columns so the
-- client can't backdate (the same L10 fix as for signup). Caller must
-- be authenticated; the RPC writes to their own row only.
create or replace function public.accept_current_terms(p_version int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'must be authenticated' using errcode = 'insufficient_privilege';
  end if;
  if p_version is null or p_version < 1 then
    raise exception 'agreed_to_terms_version must be a positive integer'
      using errcode = 'check_violation';
  end if;
  update public.profiles
     set agreed_to_terms_at      = now(),
         agreed_to_terms_version = p_version
   where id = auth.uid();
end;
$$;

revoke all on function public.accept_current_terms(int) from public;
grant execute on function public.accept_current_terms(int) to authenticated;

commit;
