-- More dive_sites.wix_slug values as their Wix travel-destination pages
-- go live. Each slug is the page under /traveldestinations/ — the SPA
-- renders the map marker + list entry as a link once the slug is set.
-- See 20260614000000_dive_sites_wix_slug.sql for the column + first site.

begin;

update public.dive_sites as d
   set wix_slug = v.slug
  from (values
    ('Bat Cave',            'bat-cave'),
    ('Cathedral',           'cathedral'),
    ('Cauliflower Garden',  'cauliflower-garden'),
    ('82.5',                '82.5'),
    ('Rainbow Reef',        'rainbow-reef'),
    ('Canyons',             'canyons'),
    ('Long Dong Bay',       'long-dong-bay'),
    ('Secret Garden',       'secret-garden'),
    ('Turtle Island',       'turtle-island')
  ) as v(name, slug)
 where d.name = v.name;

commit;
