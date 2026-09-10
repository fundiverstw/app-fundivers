-- The shop's own identity settings, authored in Manage rather than compiled in.
--
-- Four things a shop wants to change without a developer: its logo, which
-- training agency's vocabulary it speaks, what it charges in, and what language
-- the app renders in. They do not all reach the running app the same way, and
-- the table is honest about which is which:
--
--   * `logo_path` takes effect immediately. The app reads it, and so does the
--     registration PDF — the edge function fetches it from storage rather than
--     using the file vendored beside it.
--   * `standards_org` takes effect immediately. It picks the vocabulary the app
--     shows a certification in; the equivalences themselves already live in
--     `cert_levels.padi_equivalent_id`, so nothing is re-mapped, only relabelled.
--   * `currency` and `language` are recorded here but do NOT drive the running
--     build. Both are baked into the bundle at build time — the language decides
--     which message catalog is compiled in, and the currency is read by the
--     service worker and by `vite.config.ts` as well as the app. Changing them
--     means editing `fundive.config.ts` and redeploying, which is what the Shop
--     Profile page tells the admin, showing the exact lines to change. Storing
--     them here is what lets that page say what the shop *wants* and compare it
--     against what the build is actually running.
--
-- One row, forever, the way `shop_contact` does it.
create table public.shop_profile (
  singleton      boolean primary key default true check (singleton),

  -- Object path inside the `shop-logo` bucket. Null means "no logo uploaded",
  -- and every surface falls back to the deployment's own asset — a shop
  -- mid-setup has no logo yet, and a broken image is worse than the default.
  logo_path      text,

  -- Which agency's ladder the shop speaks in. Checked against `cert_levels`
  -- rather than a fixed list, so a deployment that adds an agency gets it here
  -- with no migration. Null means "use the deployment's default".
  standards_org  text,

  -- What the shop charges in. ISO 4217 where the shop uses one; `currency_label`
  -- is what a diver actually reads, which is not always the code (Taiwan writes
  -- NTD, not TWD).
  currency       text,
  currency_label text,

  -- 'en' | 'zh-TW' | 'ja'. Not checked against a list here: the set of catalogs
  -- is a property of the build, and a DB constraint would have to be migrated
  -- every time core adds a language. The page offers only what the build ships.
  language       text,

  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id) on delete set null
);

comment on table public.shop_profile is
  'The shop''s logo, training agency, currency and language. Exactly one row. '
  'Logo and agency apply at runtime; currency and language are recorded here '
  'but come from fundive.config.ts until the next deploy.';

-- Empty, so a fresh deployment renders entirely from its own config until an
-- admin says otherwise. Every reader treats null as "ask the config".
insert into public.shop_profile (singleton) values (true);

alter table public.shop_profile enable row level security;

-- Readable by anyone, including anon: the logo is chrome on the login page and
-- on the terms-acceptance flow, both of which run with no session at all.
create policy "shop_profile: public select" on public.shop_profile
  for select to authenticated, anon using (true);
create policy "shop_profile: admin update" on public.shop_profile
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- No insert or delete policy, deliberately: the row is seeded here and the
-- singleton check makes a second one impossible.
grant select on public.shop_profile to anon, authenticated;
grant update on public.shop_profile to authenticated;
grant all on public.shop_profile to service_role;

-- Stamp who changed it, the way the rest of the admin-authored tables do, and
-- refuse an agency the ladder has never heard of.
--
-- A trigger rather than a check constraint because the rule is a lookup, and a
-- check constraint cannot run a subquery. A foreign key would need
-- `cert_levels.organization` to be unique, which it is not — an agency has many
-- rungs. Rejecting the write is worth the trigger: a typo'd agency silently
-- leaves every certification unlabelled on the equivalence chart, which reads
-- as missing data rather than as a bad setting.
create or replace function public.shop_profile_stamp_updated()
returns trigger
language plpgsql
as $$
begin
  if new.standards_org is not null
     and not exists (select 1 from public.cert_levels c where c.organization = new.standards_org)
  then
    raise exception 'no certification ladder for organization %', new.standards_org
      using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists shop_profile_stamp_updated_trg on public.shop_profile;
create trigger shop_profile_stamp_updated_trg
  before update on public.shop_profile
  for each row execute function public.shop_profile_stamp_updated();

-- ── shop-logo storage bucket ────────────────────────────────────────────────
-- Public, unlike every other bucket here. The logo is shown on the login page
-- and on the emailed terms-acceptance page, neither of which has a session to
-- authorize a signed URL with, and it is a shop's public mark in any case.
insert into storage.buckets (id, name, public)
  values ('shop-logo', 'shop-logo', true)
  on conflict (id) do nothing;

create policy "shop-logo: public read" on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'shop-logo');
create policy "shop-logo: admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'shop-logo' and public.is_admin());
create policy "shop-logo: admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'shop-logo' and public.is_admin())
  with check (bucket_id = 'shop-logo' and public.is_admin());
create policy "shop-logo: admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'shop-logo' and public.is_admin());

-- ── The certification equivalence chart, as a query ─────────────────────────
-- Every agency's rungs lined up against one agency's vocabulary.
--
-- `cert_levels.padi_equivalent_id` makes PADI the hub: each row points at the
-- PADI rung it corresponds to. Two rows are therefore equivalent when they
-- point at the same rung, which is what lets the chart be drawn in ANY agency's
-- words without re-mapping anything — pick the row of the chosen agency that
-- shares a hub with the row in hand, and show its name.
--
-- Returns one row per (agency rung), carrying the hub it hangs off and the
-- chosen agency's name for that hub. `p_organization` null falls back to PADI,
-- the hub itself.
create or replace function public.cert_level_equivalences(p_organization text default null)
returns table (
  organization       text,
  rank               integer,
  code               text,
  name               text,
  hub_code           text,
  hub_name           text,
  equivalent_name    text
)
language sql
stable
as $$
  with hub as (
    select c.id, c.code, c.name from public.cert_levels c where c.organization = 'PADI'
  ),
  chosen as (
    -- The chosen agency's own rungs, keyed by the hub each one hangs off. Where
    -- an agency has two rungs on one hub (SDI's Divemaster and Assistant
    -- Instructor both map to DM), the lower rung is the one named — it is the
    -- one a diver is more likely to hold.
    select distinct on (coalesce(c.padi_equivalent_id, c.id))
           coalesce(c.padi_equivalent_id, c.id) as hub_id,
           c.name
      from public.cert_levels c
     where c.organization = coalesce(p_organization, 'PADI')
     order by coalesce(c.padi_equivalent_id, c.id), c.rank
  )
  select c.organization,
         c.rank,
         c.code,
         c.name,
         hub.code as hub_code,
         hub.name as hub_name,
         chosen.name as equivalent_name
    from public.cert_levels c
    join hub    on hub.id    = coalesce(c.padi_equivalent_id, c.id)
    left join chosen on chosen.hub_id = coalesce(c.padi_equivalent_id, c.id)
   order by c.organization, c.rank;
$$;

grant execute on function public.cert_level_equivalences(text) to authenticated, service_role;
