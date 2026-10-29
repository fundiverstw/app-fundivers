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

--
-- A few events instead hold a direct Wix CDN link
-- (https://static.wixstatic.com/media/<media-id>[/…]). The app's CSP never
-- allowed that host, so those never displayed; they map to the same local
-- path, and their copies were added to public/imgs/media alongside this.

create function pg_temp.local_image_path(ref text) returns text
language sql immutable as $$
  select case
    when btrim(ref) like 'wix:image://%' then
      '/imgs/media/' || regexp_replace(
        split_part(split_part(regexp_replace(btrim(ref), '^wix:image://v1/', ''), '#', 1), '/', 1),
        '[^a-zA-Z0-9]', '_', 'g'
      ) || '.webp'
    when btrim(ref) ~ '^https?://static\.wixstatic\.com/media/' then
      '/imgs/media/' || regexp_replace(
        split_part(split_part(split_part(
          regexp_replace(btrim(ref), '^https?://static\.wixstatic\.com/media/', ''),
          '?', 1), '#', 1), '/', 1),
        '[^a-zA-Z0-9]', '_', 'g'
      ) || '.webp'
    else ref
  end
$$;

update public.events
   set featured_image = pg_temp.local_image_path(featured_image)
 where featured_image like '%wix:image://%'
    or featured_image like '%static.wixstatic.com/media/%';

update public.travel_destinations
   set location_picture   = pg_temp.local_image_path(location_picture),
       background_picture = pg_temp.local_image_path(background_picture)
 where location_picture   similar to '%(wix:image://|static.wixstatic.com/media/)%'
    or background_picture similar to '%(wix:image://|static.wixstatic.com/media/)%';

-- The baseline gives trip_templates a `picture` column, but production no
-- longer has it, so only touch it where it exists.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'trip_templates'
       and column_name = 'picture'
  ) then
    update public.trip_templates
       set picture = pg_temp.local_image_path(picture)
     where picture like '%wix:image://%';
  end if;
end
$$;
