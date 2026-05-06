-- Per-diver dive log. Each diver owns a list of past-dive entries with
-- fields a real PADI/BSAC paper logbook records (depth, dive time, gas
-- mix, pressures, etc.) plus the conditions notes (water/air temp, vis,
-- weather, wave height) and a free-text notes field for "saw a turtle"
-- type entries. Site is intentionally free-text — the diver writes the
-- name themselves so it lands in their own language and they actually
-- remember it.
--
-- A separate `dive_log_export_requests` audit table backs the 24-hour
-- rate limit on the "email me my logs as a CSV" feature, which lives
-- in the `request-dive-log-export` edge function.

begin;

create table public.dive_logs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  -- Per-user 1, 2, 3, ... assigned by the BEFORE INSERT trigger below.
  -- Independent of the global table order so each diver sees their own
  -- numbering matching their paper logbook.
  dive_number         int  not null,
  dived_on            date not null,
  site                text not null,
  dive_type           text,
  max_depth_m         numeric(4,1),
  dive_time_min       int,
  visibility_m        numeric(4,1),
  water_temp_c        numeric(3,1),
  air_temp_c          numeric(3,1),
  weather             text,
  wave_height_m       numeric(3,1),
  weight_kg           numeric(3,1),
  gear_used           text[] not null default '{}',
  gas_mix             text,
  tank_size_l         numeric(3,1),
  start_pressure_bar  int,
  end_pressure_bar    int,
  buddy_name          text,
  instructor_name     text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint dive_logs_dive_number_per_user unique (user_id, dive_number),
  constraint dive_logs_dive_type_chk check (
    dive_type is null or dive_type in ('shore','boat','training','drift','night','wreck','other')
  ),
  constraint dive_logs_gas_mix_chk check (
    gas_mix is null or gas_mix in ('air','EAN32','EAN36','other')
  ),
  constraint dive_logs_depth_chk check (max_depth_m is null or max_depth_m between 0 and 200),
  constraint dive_logs_dive_time_chk check (dive_time_min is null or dive_time_min between 0 and 480),
  constraint dive_logs_pressure_chk check (
        (start_pressure_bar is null or start_pressure_bar between 0 and 350)
    and (end_pressure_bar   is null or end_pressure_bar   between 0 and 350)
  )
);

create index dive_logs_user_dived_on_idx
  on public.dive_logs (user_id, dived_on desc, dive_number desc);

-- Auto-assign per-user dive_number on INSERT when not provided.
-- The advisory lock serializes concurrent inserts for the same user so
-- two PWA tabs racing each other don't both compute max+1 and clash on
-- the unique constraint. It's a per-user lock keyed by hashed user id;
-- inserts for different users proceed in parallel.
create or replace function public.set_dive_log_number()
returns trigger language plpgsql as $$
begin
  if new.dive_number is null then
    perform pg_advisory_xact_lock(hashtext(new.user_id::text));
    select coalesce(max(dive_number), 0) + 1
      into new.dive_number
      from public.dive_logs
      where user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger trg_dive_logs_set_number
  before insert on public.dive_logs
  for each row execute function public.set_dive_log_number();

create or replace function public.touch_dive_log_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_dive_logs_touch_updated_at
  before update on public.dive_logs
  for each row execute function public.touch_dive_log_updated_at();

alter table public.dive_logs enable row level security;

-- Self-only CRUD. There is no admin policy: a diver's logbook is theirs.
-- If the shop ever needs aggregate stats, the service-role connection
-- will read past RLS as it does everywhere else.
create policy "dive_logs: own select"
  on public.dive_logs for select to authenticated
  using (user_id = auth.uid());

create policy "dive_logs: own insert"
  on public.dive_logs for insert to authenticated
  with check (user_id = auth.uid());

create policy "dive_logs: own update"
  on public.dive_logs for update to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "dive_logs: own delete"
  on public.dive_logs for delete to authenticated
  using (user_id = auth.uid());


-- ── Export-request audit table ─────────────────────────────────────
-- Backs the 24-hour rate limit on the "email me my dive logs as CSV"
-- feature. The diver can read their own rows so the UI can show the
-- countdown to next-available-export. Writes go through the
-- `request-dive-log-export` edge function on the service-role key
-- (bypasses RLS) — no INSERT/UPDATE/DELETE policies for users.
create table public.dive_log_export_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  requested_at  timestamptz not null default now()
);

create index dive_log_export_requests_user_time_idx
  on public.dive_log_export_requests (user_id, requested_at desc);

alter table public.dive_log_export_requests enable row level security;

create policy "dive_log_export_requests: own select"
  on public.dive_log_export_requests for select to authenticated
  using (user_id = auth.uid());

commit;
