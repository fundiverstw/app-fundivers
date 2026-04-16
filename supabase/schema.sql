-- ============================================================
-- FunDivers TW — Supabase schema
-- Run this in the Supabase SQL editor
-- ============================================================
-- Dev test account: create via Supabase dashboard or CLI before running the app
--   Email:    dev@dev.dev
--   Password: devdevdev
--   (Authentication > Users > Add user)
-- ============================================================

-- Profiles (extends auth.users)
create table public.profiles (
  id                      uuid primary key references auth.users(id) on delete cascade,
  created_at              timestamptz default now() not null,
  updated_at              timestamptz default now() not null,
  full_name               text,
  display_name            text,
  phone                   text,
  date_of_birth           date,
  nationality             text,
  id_number               text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  cert_agency             text,
  cert_level              text,
  cert_number             text,
  cert_date               date,
  medical_notes           text,
  avatar_url              text,
  role                    text not null default 'customer' check (role in ('customer','staff','admin'))
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Activities (dives, courses, events)
create table public.activities (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz default now() not null,
  title        text not null,
  description  text,
  type         text not null check (type in ('dive','course','event')),
  start_time   timestamptz not null,
  end_time     timestamptz,
  location     text,
  capacity     integer,
  price        numeric(10,2),
  currency     text not null default 'TWD',
  is_published boolean not null default false
);

-- Bookings
create table public.bookings (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz default now() not null,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending','confirmed','cancelled','waitlisted')),
  notes       text,
  unique (user_id, activity_id)
);

-- Payments (staff-recorded ledger)
create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz default now() not null,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  booking_id   uuid references public.bookings(id) on delete set null,
  amount       numeric(10,2) not null,
  currency     text not null default 'TWD',
  status       text not null default 'pending' check (status in ('pending','paid','refunded')),
  method       text,
  note         text,
  recorded_by  uuid references public.profiles(id)
);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.profiles  enable row level security;
alter table public.activities enable row level security;
alter table public.bookings   enable row level security;
alter table public.payments   enable row level security;

-- Profiles: users can read/update their own; staff can read all
create policy "Users can view own profile"
  on public.profiles for select using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

create policy "Staff can view all profiles"
  on public.profiles for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('staff','admin')));

-- Activities: anyone authenticated can read published activities
create policy "Authenticated users can view published activities"
  on public.activities for select
  using (auth.role() = 'authenticated' and is_published = true);

create policy "Staff can manage activities"
  on public.activities for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('staff','admin')));

-- Bookings: users manage their own; staff can read all
create policy "Users can view own bookings"
  on public.bookings for select using (auth.uid() = user_id);

create policy "Users can insert own bookings"
  on public.bookings for insert with check (auth.uid() = user_id);

create policy "Users can update own bookings"
  on public.bookings for update using (auth.uid() = user_id);

create policy "Staff can view all bookings"
  on public.bookings for select
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('staff','admin')));

-- Payments: users can read their own; only staff can insert/update
create policy "Users can view own payments"
  on public.payments for select using (auth.uid() = user_id);

create policy "Staff can manage payments"
  on public.payments for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('staff','admin')));
