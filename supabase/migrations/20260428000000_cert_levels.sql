-- public.cert_levels — diving certification levels referenced by events
-- (EO_dives / EO_courses) and, eventually, by diver profiles + booking
-- validation. Five standard PADI/SSI ranks: Open Water → Instructor.
--
-- The numeric `rank` column is what app code branches on ("does this
-- diver's cert >= the dive's requirement?"). `code` is a stable machine
-- identifier; `name` and `name_zh` are display strings.
--
-- New FK columns on EO_dives and EO_courses (`prereq_cert_id`) carry
-- the structured prerequisite. The legacy free-text `prereqs` column
-- stays — it now serves as additional notes (e.g. "20+ logged dives")
-- alongside the structured cert level.

begin;

create table public.cert_levels (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  name_zh     text,
  rank        int  not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint cert_levels_rank_positive check (rank > 0)
);

-- Standard PADI/SSI/RAID ranks. Higher rank = more advanced.
insert into public.cert_levels (code, name, name_zh, rank) values
  ('open_water',          'Open Water',          '開放水域',     1),
  ('advanced_open_water', 'Advanced Open Water', '進階開放水域', 2),
  ('rescue',              'Rescue',              '救援潛水員',   3),
  ('divemaster',          'Divemaster',          '潛水長',       4),
  ('instructor',          'Instructor',          '教練',         5);

alter table public.cert_levels enable row level security;

drop policy if exists "cert_levels: public select" on public.cert_levels;
drop policy if exists "cert_levels: admin insert" on public.cert_levels;
drop policy if exists "cert_levels: admin update" on public.cert_levels;
drop policy if exists "cert_levels: admin delete" on public.cert_levels;

create policy "cert_levels: public select"
  on public.cert_levels for select to anon, authenticated using (true);

create policy "cert_levels: admin insert"
  on public.cert_levels for insert to authenticated
  with check (public.is_admin());

create policy "cert_levels: admin update"
  on public.cert_levels for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

create policy "cert_levels: admin delete"
  on public.cert_levels for delete to authenticated
  using (public.is_admin());

-- FK columns. ON DELETE SET NULL so removing a cert level doesn't
-- cascade-orphan event rows; admins would then see a null prereq and
-- can re-pick.
alter table public."EO_dives"
  add column prereq_cert_id uuid references public.cert_levels(id) on delete set null;

alter table public."EO_courses"
  add column prereq_cert_id uuid references public.cert_levels(id) on delete set null;

create index eo_dives_prereq_cert_idx
  on public."EO_dives" (prereq_cert_id) where prereq_cert_id is not null;

create index eo_courses_prereq_cert_idx
  on public."EO_courses" (prereq_cert_id) where prereq_cert_id is not null;

commit;
