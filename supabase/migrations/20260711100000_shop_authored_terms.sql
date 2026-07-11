-- Shop-authored Terms of Use.
--
-- Until now the Terms text lived in code (src/config/terms.tsx, a fork seam) and
-- its version in another code constant (src/lib/terms-version.ts). A shop could
-- not change its own legal text without a redeploy, and the version that gated
-- re-acceptance was whatever the CLIENT chose to send.
--
-- This moves both into the database, mirroring the shop-authored waivers
-- (20260709120000): admins author the text in admin -> Manage; the row carries
-- its own version; and the server — not the browser — decides which version a
-- diver is consenting to.
--
-- Single row by construction: `singleton` is a constant-true primary key, so a
-- second insert fails rather than silently creating a competing Terms document.

-- ── 1. terms: the shop's own document ───────────────────────────────────────
create table public.terms (
  -- Exactly one row, forever. `check (singleton)` makes a second row impossible.
  singleton  boolean primary key default true check (singleton),
  title      text    not null default 'Terms of Use & Privacy',
  -- Markdown. Rendered read-only on /terms; never interpolated as HTML.
  body       text    not null default '',
  -- Bumped ONLY when the admin marks an edit as a material change. A typo fix
  -- leaves it alone, so divers are not re-prompted for cosmetic rewording.
  -- Mirrors the bump policy that used to live in src/lib/terms-version.ts.
  version    integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

comment on table public.terms is
  'The shop-authored Terms of Use. Exactly one row. `version` gates re-acceptance.';
comment on column public.terms.version is
  'Bumped only on a material change; drives RequireCurrentTerms re-consent.';

alter table public.terms enable row level security;

-- Diver-readable (the /terms page is public, and signup shows it before auth);
-- admin-only writes. Mirrors waivers / cancellation_policies.
create policy "terms: public select" on public.terms
  for select to authenticated, anon using (true);
create policy "terms: admin update" on public.terms
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- No insert/delete policy on purpose: the single row is seeded here and must
-- never be removed. Even an admin can only UPDATE it.

-- The version must never go backwards, or a diver who accepted v3 would silently
-- satisfy a "current" v2 and never be re-prompted.
create or replace function public.terms_version_monotonic()
  returns trigger
  language plpgsql
as $$
begin
  if new.version < old.version then
    raise exception 'terms.version cannot decrease (% -> %)', old.version, new.version
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger terms_version_monotonic
  before update on public.terms
  for each row execute function public.terms_version_monotonic();

-- Seed the single row. Empty body: the shop authors it (the admin editor offers
-- a fill-in-the-details starter template). A fresh install therefore shows an
-- empty Terms page rather than someone else's legal text.
insert into public.terms (singleton) values (true);

-- ── 2. accept_current_terms: the server decides the version ─────────────────
-- Previously the client passed p_version, so a modified browser could "accept"
-- a version that was never shown. Now the RPC reads the live version itself.
-- The old signature is dropped, not kept as a shim: nothing is in production.
drop function if exists public.accept_current_terms(integer);

create or replace function public.accept_current_terms()
  returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_version integer;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated' using errcode = 'insufficient_privilege';
  end if;

  select version into v_version from public.terms;
  if v_version is null then
    raise exception 'no terms row' using errcode = 'no_data_found';
  end if;

  update public.profiles
     set agreed_to_terms_at      = now(),
         agreed_to_terms_version = v_version
   where id = auth.uid();

  return v_version;
end;
$$;

alter function public.accept_current_terms() owner to postgres;
revoke all on function public.accept_current_terms() from public, anon;
grant execute on function public.accept_current_terms() to authenticated;

-- ── 3. handle_new_user: signup records the SERVER's terms version ───────────
-- Was: `coalesce(client_ver, 1)` — the browser chose which version it had
-- "agreed" to. A modified client could record a version far above the real one
-- and never be re-prompted by RequireCurrentTerms. Whether the user consented
-- is still a client fact (it's a checkbox); WHICH version they consented to is
-- now read from public.terms.
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  consented   bool := new.raw_user_meta_data ? 'agreed_to_terms_at';
  live_ver    int;
begin
  select version into live_ver from public.terms;

  insert into public.profiles (id, email, agreed_to_terms_at, agreed_to_terms_version)
  values (
    new.id,
    new.email,
    case when consented then now() else null end,
    case when consented then coalesce(live_ver, 1) else null end
  );
  return new;
end;
$$;

alter function public.handle_new_user() owner to postgres;
