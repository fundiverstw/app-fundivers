-- Web Push: device subscriptions + idempotency ledger for the daily reminder
-- cron. One row per device in push_subscriptions; one row per (user, event,
-- reminder-kind) in push_notifications_sent so the cron can be rerun safely.

begin;

create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

create table public.push_notifications_sent (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  event_id    text not null,
  event_type  text not null check (event_type in ('dive','course')),
  kind        text not null check (kind in (
    'event_7d','event_1d',
    'payment_21d','payment_14d','payment_7d','payment_3d','payment_1d'
  )),
  sent_at     timestamptz not null default now(),
  primary key (user_id, event_id, kind)
);

alter table public.push_subscriptions      enable row level security;
alter table public.push_notifications_sent enable row level security;

-- Users manage their own push_subscriptions rows; the cron worker uses
-- service_role (bypasses RLS). push_notifications_sent is service-role only,
-- so it needs RLS on with no policies.

create policy "user reads own push subs"
  on public.push_subscriptions for select using (auth.uid() = user_id);

create policy "user inserts own push sub"
  on public.push_subscriptions for insert with check (auth.uid() = user_id);

create policy "user updates own push sub"
  on public.push_subscriptions for update using (auth.uid() = user_id);

create policy "user deletes own push sub"
  on public.push_subscriptions for delete using (auth.uid() = user_id);

commit;
