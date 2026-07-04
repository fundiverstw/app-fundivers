-- ============================================================
-- trusted_partners — dive shops the business vouches for abroad
-- ============================================================
-- A small admin-managed catalog surfaced ONLY on the diver-facing Trusted
-- Partners tab. A diver picks a partner and sends them a message; the
-- contact-trusted-partner edge function emails the partner FROM the shop's
-- address (so the partner knows it's brokered by the business), CC's the shop
-- inbox, and sets reply-to to the diver so the partner can answer directly.
--
-- The partner's `email` must never reach the client (it would ship in the JS
-- bundle / be queryable over PostgREST). So:
--   * RLS grants SELECT to admins only — a diver cannot read any row directly.
--   * Divers read the public columns (no email) via list_trusted_partners(),
--     a SECURITY DEFINER function that returns name/region/blurb only.
--   * The edge function resolves the email server-side with the service role.

begin;

create table public.trusted_partners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Where they operate, shown to divers (e.g. "Palau", "Anilao").
  region      text,
  -- Short diver-facing description of the shop.
  blurb       text,
  -- Server-side only — never selected by the client.
  email       text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id) on delete set null
);

create index trusted_partners_active_idx on public.trusted_partners (active) where active;

alter table public.trusted_partners enable row level security;

-- Admins manage the catalog and are the only role that can read rows directly
-- (the CRUD screen needs the email). Divers get the public columns via the RPC.
create policy "trusted_partners: admin manage"
  on public.trusted_partners for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Public projection for divers: active partners, no email. SECURITY DEFINER so
-- it bypasses the admin-only RLS above while still withholding the email column.
create or replace function public.list_trusted_partners()
returns table (id uuid, name text, region text, blurb text)
language sql
stable
security definer
set search_path = public
as $$
  select id, name, region, blurb
  from public.trusted_partners
  where active
  order by name
$$;

grant execute on function public.list_trusted_partners() to authenticated;

commit;

notify pgrst, 'reload schema';
