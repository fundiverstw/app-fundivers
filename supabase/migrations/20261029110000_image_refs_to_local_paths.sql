-- Store image references as plain paths, not Wix media refs.
--
-- Event and destination photos were recorded as Wix media refs
-- (wix:image://v1/<media-id>/<file>#originWidth=…), and the app translated each
-- one at display time into its self-hosted copy, /imgs/media/<slug>.webp, where
-- <slug> is the media id with every non-alphanumeric character replaced by `_`.
-- With the site off Wix, store that path directly. The app now accepts only a
-- site path (/imgs/…) or an http(s) URL, so it no longer needs to know the Wix
-- format at all.
--
-- The mapping is the same one src/lib/images.ts used, so every photo that
-- displayed before still displays. A ref whose copy was never harvested points
-- at a missing file, which the cards already handle (gradient fallback), the
-- same as before.

create function pg_temp.local_image_path(ref text) returns text
language sql immutable as $$
  select case
    when btrim(ref) like 'wix:image://%' then
      '/imgs/media/' || regexp_replace(
        split_part(split_part(regexp_replace(btrim(ref), '^wix:image://v1/', ''), '#', 1), '/', 1),
        '[^a-zA-Z0-9]', '_', 'g'
      ) || '.webp'
    else ref
  end
$$;

update public.events
   set featured_image = pg_temp.local_image_path(featured_image)
 where featured_image like '%wix:image://%';

update public.travel_destinations
   set location_picture   = pg_temp.local_image_path(location_picture),
       background_picture = pg_temp.local_image_path(background_picture)
 where location_picture like '%wix:image://%'
    or background_picture like '%wix:image://%';

update public.trip_templates
   set picture = pg_temp.local_image_path(picture)
 where picture like '%wix:image://%';
