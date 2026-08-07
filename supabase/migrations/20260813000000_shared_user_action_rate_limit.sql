-- A shared per-user rate limiter for the authenticated endpoints that send mail.
--
-- Fifteen edge functions send email. Only two bounded it: create-registration
-- (guest path, per-IP, via signup_attempts) and request-dive-log-export (24h
-- cooldown, via its own table). Every other mail-sending endpoint that an
-- ordinary signed-in diver can reach was unbounded, so a single account could
-- loop one of them and exhaust the shop's Gmail quota.
--
-- That is not merely spam. The same quota carries waitlist offers, booking
-- confirmations and cancellation notices, so exhausting it silently disables
-- the notifications the shop's operations depend on -- a denial of service on
-- the business, from any account, with no privilege required.
--
-- request-dive-log-export already proved the shape (a row per attempt, count
-- the recent ones, refuse past a threshold). Generalising it beats copying a
-- bespoke table per endpoint: one place to audit, one place to tune, and an
-- endpoint added later gets the limiter by naming an action rather than by
-- remembering to invent a table.
--
-- dive_log_export_requests is deliberately left alone. It is not just a
-- limiter -- the SPA reads it to render a next-available countdown -- so
-- folding it in here would be a behaviour change dressed up as a refactor.

create table public.user_action_attempts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  action     text not null,
  created_at timestamptz not null default now()
);

comment on table public.user_action_attempts is
  'One row per rate-limited action attempt. Written only by take_action_slot(); see the edge functions in supabase/functions that send mail.';

-- The limiter only ever asks "how many rows for this user+action since T",
-- which this index answers directly.
create index user_action_attempts_lookup_idx
  on public.user_action_attempts (user_id, action, created_at desc);

-- Service-role only: the limiter runs inside SECURITY DEFINER, and no client
-- has any business reading or writing the ledger. RLS on with no policy is the
-- deny-all default for every other role, matching signup_attempts.
alter table public.user_action_attempts enable row level security;

grant select, insert, delete on table public.user_action_attempts to service_role;

-- Claims a slot for (user, action). Returns 0 when the caller may proceed, or
-- the number of seconds until the oldest attempt in the window ages out.
--
-- Check and insert are one statement's worth of work under an advisory lock
-- keyed on user+action, so two concurrent requests cannot both read a count of
-- N-1 and both insert. Without it the limit is approximate, which for a control
-- whose whole job is to stop a loop is not good enough.
create or replace function public.take_action_slot(
  p_user_id uuid,
  p_action  text,
  p_limit   integer,
  p_window  interval
) returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_count  integer;
  v_oldest timestamptz;
begin
  if p_user_id is null or p_action is null then
    raise exception 'user and action required' using errcode = 'null_value_not_allowed';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'limit must be positive' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || p_action));

  select count(*), min(created_at) into v_count, v_oldest
    from public.user_action_attempts
   where user_id = p_user_id
     and action = p_action
     and created_at > now() - p_window;

  if v_count >= p_limit then
    -- Sliding window: the caller may retry once the oldest attempt leaves it.
    return greatest(1, ceil(extract(epoch from (v_oldest + p_window - now())))::integer);
  end if;

  insert into public.user_action_attempts (user_id, action) values (p_user_id, p_action);

  -- Opportunistic housekeeping, bounded to this user+action so it stays O(few).
  delete from public.user_action_attempts
   where user_id = p_user_id
     and action = p_action
     and created_at < now() - greatest(p_window, interval '7 days');

  return 0;
end;
$$;

alter function public.take_action_slot(uuid, text, integer, interval) owner to postgres;
revoke all on function public.take_action_slot(uuid, text, integer, interval) from public, anon, authenticated;
grant execute on function public.take_action_slot(uuid, text, integer, interval) to service_role;

comment on function public.take_action_slot(uuid, text, integer, interval) is
  'Sliding-window rate limiter. Returns 0 to allow, else seconds until retry. Service-role only -- callers are edge functions.';
