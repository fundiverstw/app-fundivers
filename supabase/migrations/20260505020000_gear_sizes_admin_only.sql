-- Lock fin_size / bcd_size / wetsuit_size on public.profiles to staff and
-- admin only. Reverses the diver self-update path that
-- 20260430020000_profile_gear_sizes.sql left open.
--
-- Why a trigger instead of an RLS policy: row-level policies can't see the
-- diff between OLD and NEW columns, only whether the row should be visible
-- for write at all. We still want divers to edit their own profile (name,
-- contact, cert, etc.) — we just want the three gear-size columns to be
-- definer-only. A BEFORE UPDATE trigger that compares OLD/NEW with
-- IS DISTINCT FROM gives us per-column gating without re-shaping the
-- existing self-update RLS policy.
--
-- The existing public.update_diver_gear_sizes RPC is SECURITY DEFINER and
-- gates on public.is_staff_or_admin(); auth.uid() inside the RPC is still
-- the original caller's id so the trigger's is_staff_or_admin() check
-- matches and the RPC can update freely.

begin;

create or replace function public.block_self_gear_size_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff_or_admin() then
    if new.fin_size     is distinct from old.fin_size
       or new.bcd_size     is distinct from old.bcd_size
       or new.wetsuit_size is distinct from old.wetsuit_size then
      raise exception 'Gear sizes can only be set by staff or admins'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_block_self_gear_size_trg on public.profiles;
create trigger profiles_block_self_gear_size_trg
  before update on public.profiles
  for each row execute function public.block_self_gear_size_change();

commit;
