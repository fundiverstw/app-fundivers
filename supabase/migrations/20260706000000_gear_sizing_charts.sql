-- ============================================================
-- gear_sizing_charts — per-shop wetsuit / BCD / fins sizing charts
-- ============================================================
-- Each shop stocks its own gear brands/models, each with its own size bands.
-- Admins enter a chart per model; on the logistics board staff click a diver's
-- gear chip and get a ranked, read-only list of the shop's models/sizes that
-- fit that diver (matched from profile height_cm / weight_kg / shoe_size /
-- gender). No stock tracking — this is a packing aid, not inventory.
--
--   gear_models       — one product line (e.g. "Women's Saeko Wetsuit").
--   gear_model_sizes  — its size rows, each with min/max fit ranges.
--
-- Staff read (the lookup runs on the logistics board); admin writes.

begin;

create table public.gear_models (
  id          uuid primary key default gen_random_uuid(),
  gear_type   text not null check (gear_type in ('wetsuit', 'bcd', 'fins')),
  name        text not null,
  brand       text,
  -- Who the model is cut for; null = unisex/any. Matched against the diver's
  -- profile.gender ('female'/'male'/'other'), plus 'kids' routed by size.
  gender      text check (gender in ('female', 'male', 'kids')),
  -- Fins only: the unit the size bands are expressed in, so the matcher can
  -- convert the diver's shoe size before comparing. null for wetsuit/bcd.
  size_unit   text check (size_unit in ('jp', 'eu', 'us', 'uk', 'cm')),
  notes       text,        -- e.g. "5mm", stocking notes
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id) on delete set null
);

create index gear_models_type_active_idx on public.gear_models (gear_type, active);

create table public.gear_model_sizes (
  id          uuid primary key default gen_random_uuid(),
  model_id    uuid not null references public.gear_models(id) on delete cascade,
  label       text not null,      -- '7' / 'ML' / 'Pink'
  -- Fit ranges on the measures that matter; all nullable so a chart fills only
  -- the axes it uses (wetsuit: height+weight; fins: shoe). A diver "fits" a size
  -- when they fall inside its populated ranges; the matcher ranks nearest when
  -- a diver falls between sizes (height points to one, weight to another).
  height_min  numeric,
  height_max  numeric,
  weight_min  numeric,
  weight_max  numeric,
  shoe_min    numeric,
  shoe_max    numeric,
  -- Reference-only, shown to staff but not auto-matched (divers carry no such
  -- data). Free text to hold "32/33", "40+", "30.5".
  chest       text,
  waist       text,
  hip         text,
  sort_order  integer not null default 0
);

create index gear_model_sizes_model_idx on public.gear_model_sizes (model_id);

alter table public.gear_models enable row level security;
alter table public.gear_model_sizes enable row level security;

-- Staff + admin read (the fit lookup runs on the logistics board); admin writes.
create policy "gear_models: staff read" on public.gear_models
  for select to authenticated using (public.is_staff_or_admin());
create policy "gear_models: admin write" on public.gear_models
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "gear_model_sizes: staff read" on public.gear_model_sizes
  for select to authenticated using (public.is_staff_or_admin());
create policy "gear_model_sizes: admin write" on public.gear_model_sizes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

commit;

notify pgrst, 'reload schema';
