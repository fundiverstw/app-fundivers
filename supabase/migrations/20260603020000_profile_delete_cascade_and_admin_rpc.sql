-- Profile / auth.users coupling: prevent orphan auth.users when a
-- profile row is deleted directly, and give admins a clean "Delete
-- user" RPC that wipes both halves of an account.
--
-- Background. profiles.id has `references auth.users(id) on delete
-- cascade`, so deleting auth.users wipes the profile. The reverse
-- direction wasn't covered: a direct `delete from profiles where ...`
-- (Studio surgery, test cleanup, future tooling) used to leave the
-- auth.users row orphaned. Effect: the user could still authenticate
-- and reset their password, but every SPA profile fetch returned 0
-- rows and useAuth looped on 406s with no recovery path.
--
-- Two pieces here:
--
--   1. AFTER DELETE trigger on profiles → delete the matching
--      auth.users row. Guards on pg_trigger_depth() so it no-ops when
--      already running inside the auth.users → profiles cascade
--      (i.e. the originating auth.users DELETE is in flight, so
--      re-issuing it would be redundant and risks self-recursion).
--
--   2. admin_delete_user(uuid) RPC: gated by is_admin(), refuses
--      self-deletion, deletes auth.users. The existing FK cascade
--      handles profiles + every dependent table. profiles_admin_audit_trg
--      from 20260423140000 already fires for admin DELETEs and
--      captures the before-snapshot, so no extra audit code lives
--      here.
--
-- Things to know for callers:
--
-- * FKs from payments.recorded_by, credits.created_by,
--   booking_amendments.created_by, event_memos.resolved_by are
--   ON DELETE NO ACTION. If the target user has recorded payments /
--   issued credits / etc., the delete raises foreign_key_violation
--   and the SPA surfaces the Postgres error. The admin can downgrade
--   to a soft-delete or null those refs later — there's no need to
--   bake that policy in here.
--
-- * Existing rollback paths in create-registration /
--   create-child-account / admin-create-diver all delete auth.users
--   via admin.auth.admin.deleteUser. Those continue to work — the
--   cascade trigger no-ops via pg_trigger_depth().

begin;

-- ============================================================
-- 1. Cascade-down trigger: profile delete → auth.users delete
-- ============================================================

create or replace function public.cascade_profile_delete_to_auth_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  delete from auth.users where id = old.id;
  return old;
end;
$$;

drop trigger if exists profiles_cascade_delete_to_auth_users_trg
  on public.profiles;
create trigger profiles_cascade_delete_to_auth_users_trg
  after delete on public.profiles
  for each row execute function public.cascade_profile_delete_to_auth_users();

-- ============================================================
-- 2. admin_delete_user RPC
-- ============================================================

create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin only'
      using errcode = 'insufficient_privilege';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot delete your own account'
      using errcode = 'check_violation';
  end if;
  delete from auth.users where id = p_user_id;
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public;
grant execute on function public.admin_delete_user(uuid) to authenticated;

commit;
