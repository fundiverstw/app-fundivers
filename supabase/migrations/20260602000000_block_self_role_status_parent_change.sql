-- Security audit C1 (2026-06-02): block non-admin updates to
-- profiles.role / profiles.status / profiles.parent_account.
--
-- The existing "profiles: self update" and "profiles: parent update
-- children" RLS policies in 20260423130000 and 20260514030000 are
-- row-scoped only — RLS cannot see column diffs. Without this
-- trigger any authenticated caller can
--     PATCH /rest/v1/profiles?id=eq.<self> {"role":"admin"}
-- and PostgREST will accept it. Same shape lets a parent self-promote
-- via the child row.
--
-- Trigger pattern mirrors block_self_gear_size_change in
-- 20260505020000_gear_sizes_admin_only.sql.
--
-- Pass-through paths (intentional):
--   * Service-role contexts (edge functions, cron, Studio SQL editor):
--     auth.uid() is null, so the gate returns NEW. The audit-log
--     trigger on profiles already records admin writes via PostgREST;
--     dashboard / cron writes are not auditable here either way.
--   * Admin acting via PostgREST: is_admin() is true.
--   * handle_new_user signup trigger: BEFORE INSERT — does not fire
--     here (UPDATE only).
--
-- Blocked path: any non-admin user JWT (diver, staff, parent)
-- attempting to change role, status, or parent_account on a row the
-- existing RLS policies otherwise let them update.

begin;

create or replace function public.block_self_privileged_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.role           is distinct from old.role
     or new.status        is distinct from old.status
     or new.parent_account is distinct from old.parent_account then
    raise exception
      'role, status, and parent_account are admin-managed'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_block_self_privileged_change_trg
  on public.profiles;
create trigger profiles_block_self_privileged_change_trg
  before update on public.profiles
  for each row execute function public.block_self_privileged_profile_change();

commit;
