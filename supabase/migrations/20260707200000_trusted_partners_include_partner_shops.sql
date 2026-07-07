-- ============================================================
-- Trusted Partners now also surface the Packages partner shops
-- ============================================================
-- A "partner shop" added for Packages (public.partner_shops, the vouching
-- registry behind the Packages board) is the same kind of thing the Trusted
-- Partners tab lists: a dive shop abroad the business vouches for and a diver
-- can message. Rather than make an admin re-enter every shop into
-- trusted_partners, list_trusted_partners() now returns BOTH catalogs, so a
-- shop added for Packages automatically appears on the Trusted Partners page.
--
-- The projection is unchanged (id, name, region, blurb — never an email), so
-- the diver client and its types are untouched. For a partner shop we map:
--   name  <- name
--   region <- coalesce(location, country)   (its most specific "where")
--   blurb  <- vouch_notes                    (already diver-facing via the board)
-- All three are columns divers can already read through list_package_board();
-- contact_email and the kickback columns stay server-side.
--
-- Only shops that are active AND have a contact_email are included: the Trusted
-- Partners page is built around messaging a partner (contact-trusted-partner
-- resolves the email server-side), so — exactly as trusted_partners.email is
-- NOT NULL — every listed partner must be reachable. A shop with no contact
-- email simply doesn't appear here (it still hosts its Packages).
--
-- ids never collide (both tables key on random uuids), so the edge function can
-- resolve a partner_id against either table; see contact-trusted-partner.

begin;

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
  union all
  select id, name, coalesce(location, country) as region, vouch_notes as blurb
  from public.partner_shops
  where active and contact_email is not null
  order by name
$$;

grant execute on function public.list_trusted_partners() to authenticated, anon, service_role;

commit;

notify pgrst, 'reload schema';
