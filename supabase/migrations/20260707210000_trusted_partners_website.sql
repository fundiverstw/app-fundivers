-- ============================================================
-- Trusted Partners: a partner's own website (diver-facing link)
-- ============================================================
-- A trusted partner / partner shop can now carry a link to its own website, so
-- the "in cooperation with…" listing a diver sees can point straight at the
-- partner. partner_shops already has a `website` column (surfaced as
-- partner_website on the Packages board); this adds the equivalent to the
-- standalone trusted_partners directory and widens list_trusted_partners() to
-- return `website` for both catalogs.
--
-- website is a plain diver-facing URL (no secrets), so it joins name/region/blurb
-- in the public projection. The return SHAPE changes (a new column), so the
-- function is dropped and recreated rather than replaced.

begin;

alter table public.trusted_partners
  add column if not exists website text;

drop function if exists public.list_trusted_partners();

create function public.list_trusted_partners()
returns table (id uuid, name text, region text, blurb text, website text)
language sql
stable
security definer
set search_path = public
as $$
  select id, name, region, blurb, website
  from public.trusted_partners
  where active
  union all
  select id, name, coalesce(location, country) as region, vouch_notes as blurb, website
  from public.partner_shops
  where active and contact_email is not null
  order by name
$$;

grant execute on function public.list_trusted_partners() to authenticated, anon, service_role;

commit;

notify pgrst, 'reload schema';
