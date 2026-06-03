-- H2 — throttle guest signups + capture rollback orphans.
--
-- The create-registration edge function was previously a free
-- create-auth-user-and-send-emails endpoint with no rate limit,
-- captcha, or post-failure cleanup. Two structural pieces this
-- migration adds; Turnstile + the handler-side check land in the
-- edge function in the same PR.
--
--   1. signup_attempts — one row per guest-path call to the
--      edge function, keyed by a SHA-256 hash of the client IP.
--      The hash protects raw IPs from sitting in the DB. The
--      record_signup_attempt RPC inserts a row and atomically
--      returns the count of attempts in the trailing 60s and
--      24h, so the edge function can decide to throttle on either
--      window without a separate select.
--
--   2. orphan_auth_users — rollback target. When createUser
--      succeeds but a subsequent step fails, the handler tries to
--      auth.admin.deleteUser(...) the new row. If THAT also fails,
--      previously we silently swallowed the error and left a real
--      auth.users row dangling. Now we record (user_id, email,
--      reason) here so a janitor (manual sweep or future cron) can
--      clean up.
--
-- Both tables: RLS on, NO policies. Only the service-role client
-- (via the SECURITY DEFINER RPCs / direct service-role calls) can
-- read or write. No diver, staff, or admin JWT has any access.

begin;

-- ============================================================
-- 1. signup_attempts
-- ============================================================

create table public.signup_attempts (
  id          bigserial primary key,
  ip_hash     bytea       not null,
  created_at  timestamptz not null default now()
);

create index signup_attempts_ip_recent_idx
  on public.signup_attempts (ip_hash, created_at desc);
create index signup_attempts_created_idx
  on public.signup_attempts (created_at desc);

alter table public.signup_attempts enable row level security;
-- No policies: only the service-role client can touch this table.

-- record_signup_attempt — log + count in one round-trip so the
-- handler doesn't need a separate select. Returns the window counts
-- INCLUDING the row just inserted, so a caller checking >5 will
-- treat the 6th call as over-limit (the 6th itself counts).
create or replace function public.record_signup_attempt(p_ip_hash bytea)
returns table (in_last_60s int, in_last_24h int)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.signup_attempts (ip_hash) values (p_ip_hash);
  return query
    select
      count(*) filter (where created_at > now() - interval '60 seconds')::int,
      count(*) filter (where created_at > now() - interval '24 hours')::int
    from public.signup_attempts
    where ip_hash = p_ip_hash;
end;
$$;

revoke all on function public.record_signup_attempt(bytea) from public;
grant execute on function public.record_signup_attempt(bytea) to service_role;

-- ============================================================
-- 2. orphan_auth_users
-- ============================================================

create table public.orphan_auth_users (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null,
  email       text,
  reason      text        not null,
  created_at  timestamptz not null default now()
);

create index orphan_auth_users_created_idx
  on public.orphan_auth_users (created_at desc);

alter table public.orphan_auth_users enable row level security;
-- No policies: service-role only.

create or replace function public.log_orphan_auth_user(
  p_user_id uuid,
  p_email   text,
  p_reason  text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.orphan_auth_users (user_id, email, reason)
  values (p_user_id, p_email, p_reason);
end;
$$;

revoke all on function public.log_orphan_auth_user(uuid, text, text) from public;
grant execute on function public.log_orphan_auth_user(uuid, text, text) to service_role;

commit;
