-- Per-diver gear sizing (fin / BCD / wetsuit). Sized fields are free
-- text so divers / staff can use whatever sizing convention the gear
-- vendor uses (S/M/L, EU sizes, "8-9" ranges, etc.).
--
-- Two write paths:
--   1. Diver self-update via the existing
--      "profiles: self update" policy on profiles UPDATE — no change.
--   2. Staff / admin update via the new
--      public.update_diver_gear_sizes(diver_id, fin, bcd, wetsuit) RPC.
--      The RPC is SECURITY DEFINER and gated on
--      public.is_staff_or_admin(), so staff can write *only these three
--      columns* (anywhere they have read access). The table-level
--      UPDATE policy stays admin-only — this preserves the
--      defense-in-depth scope established by 20260429240000_staff_role.sql.

begin;

alter table public.profiles
  add column if not exists fin_size     text,
  add column if not exists bcd_size     text,
  add column if not exists wetsuit_size text;

-- Narrow staff/admin write path. Always overwrites all three columns;
-- callers pass through the current value for any field they don't mean
-- to change. Empty string is normalized to NULL so an admin clearing a
-- field doesn't leave a blank string in the DB.
create or replace function public.update_diver_gear_sizes(
  diver_id     uuid,
  fin_size     text,
  bcd_size     text,
  wetsuit_size text
) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff_or_admin() then
    raise exception 'staff or admin required'
      using errcode = 'insufficient_privilege';
  end if;
  update public.profiles
  set fin_size     = nullif(btrim(coalesce(update_diver_gear_sizes.fin_size,     '')), ''),
      bcd_size     = nullif(btrim(coalesce(update_diver_gear_sizes.bcd_size,     '')), ''),
      wetsuit_size = nullif(btrim(coalesce(update_diver_gear_sizes.wetsuit_size, '')), '')
  where id = update_diver_gear_sizes.diver_id;
end;
$$;

grant execute on function public.update_diver_gear_sizes(uuid, text, text, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
