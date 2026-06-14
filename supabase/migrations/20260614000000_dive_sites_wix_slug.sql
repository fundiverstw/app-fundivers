-- public.dive_sites.wix_slug — links a map site to its page on the Wix
-- marketing site, when one exists.
--
-- The SPA builds https://www.fundiverstw.com/traveldestinations/<wix_slug>
-- and renders the site name as a link only when wix_slug is set. Most sites
-- have no dedicated Wix page yet, so the column is nullable and the link is
-- opt-in per site — populated here (and in future forward migrations) as
-- pages are published. Slug, not full URL: every travel-destination page
-- lives under the same /traveldestinations/ path, so the base is a single
-- front-end constant.

begin;

alter table public.dive_sites add column wix_slug text;

update public.dive_sites
   set wix_slug = 'wan-an-jian-navy-wreck'
 where name = 'Wan An Jian Navy Wreck';

commit;
