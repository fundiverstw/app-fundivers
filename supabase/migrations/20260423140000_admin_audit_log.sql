-- Audit log for admin mutations to bookings + profiles. Triggered after any
-- row-level write; if the caller is an admin (per public.is_admin()), records
-- who changed what, with full before/after snapshots for diffing.
--
-- Only admin edits get logged — a diver updating their own profile or
-- booking isn't noise-worthy for the incident-response use case this is
-- built for ("which staff member changed this person's medical notes?").
--
-- Read access is admin-only. No direct writes: the trigger function is
-- SECURITY DEFINER and owns the insert path.

begin;

create table public.admin_audit_log (
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  actor_id      uuid        references public.profiles(id) on delete set null,
  action        text        not null check (action in ('insert','update','delete')),
  target_table  text        not null,
  target_id     text        not null,
  before        jsonb,
  after         jsonb
);

create index admin_audit_log_actor_idx  on public.admin_audit_log (actor_id, created_at desc);
create index admin_audit_log_target_idx on public.admin_audit_log (target_table, target_id, created_at desc);
create index admin_audit_log_recent_idx on public.admin_audit_log (created_at desc);

-- Trigger function: runs as definer so the INSERT bypasses the audit-log
-- table's RLS. `auth.uid()` still reflects the original caller.
create or replace function public.audit_admin_write() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- Skip logging for service-role / migrations (auth.uid() is null), for
  -- the diver acting on their own row, and for the trigger's own internal
  -- calls if any (defensive).
  if auth.uid() is null or not public.is_admin() then
    return coalesce(new, old);
  end if;

  insert into public.admin_audit_log (actor_id, action, target_table, target_id, before, after)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce((new).id::text, (old).id::text),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );

  return coalesce(new, old);
end;
$$;

create trigger bookings_admin_audit_trg
  after insert or update or delete on public.bookings
  for each row execute function public.audit_admin_write();

create trigger profiles_admin_audit_trg
  after insert or update or delete on public.profiles
  for each row execute function public.audit_admin_write();

alter table public.admin_audit_log enable row level security;

create policy "admin_audit_log: admin select"
  on public.admin_audit_log for select to authenticated
  using (public.is_admin());

-- No insert/update/delete policies — writes only via the trigger function.

commit;
