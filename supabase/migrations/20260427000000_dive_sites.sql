-- public.dive_sites — backing table for /map.
--
-- Each row is one named dive spot tied to one of the eight map regions
-- the SPA renders as click targets. Public read so cold visitors can see
-- the markers; admin-only write via the same is_admin() helper used by
-- EO_dives / EO_courses / EO_prices.
--
-- Region is a text column with a CHECK constraint rather than a FK to a
-- separate regions table — there are eight fixed regions and the front-end
-- already knows their metadata (bbox, center, description). Adding a region
-- is a one-line constraint update plus a front-end constant.

begin;

create table public.dive_sites (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  tagline     text,
  latitude    numeric(10, 7) not null,
  longitude   numeric(10, 7) not null,
  region      text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint dive_sites_region_check check (
    region in ('keelung', 'longdong', 'yilan', 'greenisland', 'lanyu', 'xiaoliuqiu', 'kenting', 'penghu')
  )
);

create index dive_sites_region_idx on public.dive_sites (region);

alter table public.dive_sites enable row level security;

drop policy if exists "dive_sites: public select" on public.dive_sites;
drop policy if exists "dive_sites: admin insert" on public.dive_sites;
drop policy if exists "dive_sites: admin update" on public.dive_sites;
drop policy if exists "dive_sites: admin delete" on public.dive_sites;

create policy "dive_sites: public select"
  on public.dive_sites for select to anon, authenticated using (true);

create policy "dive_sites: admin insert"
  on public.dive_sites for insert to authenticated
  with check (public.is_admin());

create policy "dive_sites: admin update"
  on public.dive_sites for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

create policy "dive_sites: admin delete"
  on public.dive_sites for delete to authenticated
  using (public.is_admin());

-- Seed: 19 starter sites pulled from FunDivers' booking system. New sites
-- can be added via the admin UI later; this seed is the initial cut.
insert into public.dive_sites (name, tagline, latitude, longitude, region) values
  ('Cauliflower Garden',
   'Cauliflower Garden is a charming wall dive with lovely little, colorful, soft corals shaped like cauliflower.',
   24.9811625, 121.9658281, 'yilan'),
  ('Badouzi Bay: Iron House / Iron Reef',
   'These are artificial reefs made of steel shaped like the framework of houses. Within its confines, reside an array of fish using them as protection from predators such as the amberjacks.',
   25.1429625, 121.8129844, 'keelung'),
  ('Penghu',
   'Of all the dive locations in Taiwan, Penghu has the most fish in numbers, size, and diversity! If you have the experience and time, it''s a definite must-see!',
   23.5711899, 119.5793157, 'penghu'),
  ('Secret Garden',
   'Secret Garden is a favorite among local divers. With its garden of sea fans, whip, and soft coral. It is truly a must-see site on the Northeast Coast of Taiwan.',
   25.1434517, 121.8034149, 'keelung'),
  ('Turtle Island',
   'Turtle Island is known to Divers for the site called Milky Way, an underwater hot spring. If you get this rare opportunity to dive there, you must try it!',
   24.8423735, 121.9501551, 'yilan'),
  ('Kenting',
   'Kenting has been a top dive destination in Taiwan for decades. It is best known for its myriad of corals that are plastered atop the reef.',
   21.9483307, 120.7797516, 'kenting'),
  ('Cathedral',
   'The Cathedral is a unique dive site suitable for all levels of Divers and is always full of surprises!',
   25.0328125, 121.9425625, 'yilan'),
  ('Green Island',
   'Green Island is located off the coast of Taitung, on the southeast coast of Taiwan. It is a favorite dive destination for many locals. Renowned for its impressive visibility, which can reach up to 30-40m, it is ideal for photography enthusiasts.',
   22.6620886, 121.4901443, 'greenisland'),
  ('Canyons',
   'An interesting site with beatiful slopes, walls, and boulders to explore.',
   25.1226015, 121.9040652, 'longdong'),
  ('Badouzi Bay: Shipwrecks',
   'With many shipwrecks sparsely placed in the vicinity of Badouzi Bay, scuba divers have a fantastic opportunity to explore these fishing vessels that have now become artificial reefs.',
   25.1429625, 121.8129844, 'keelung'),
  ('Iron House 2',
   'Iron House 2 has 2 metal frame structures side by side shaped like square building blocks teeming with life.',
   25.1429625, 121.8129844, 'keelung'),
  ('82.5',
   'The wall here at 82.5 always has interesting creatures and rock formations to observe.',
   25.1201875, 121.8996875, 'longdong'),
  ('Badouzi Bay: Crystal Temple Wall',
   'A 100m stretch of wall starting at 15m down to 30m.',
   25.1358875, 121.8182969, 'keelung'),
  ('Long Dong Bay',
   'Long Dong Bay has a walk-in ramp that makes it easy for entering and exiting when the conditions are calm. Perfect for beginners and advanced Divers alike.',
   25.1133125, 121.9200625, 'longdong'),
  ('Wan An Jian Navy Wreck',
   'Wan An Jian is a massive navy wreck covered in life and surrounded by schools of fish located off the east coast of Taiwan.',
   24.9618125, 121.9458125, 'yilan'),
  ('Rainbow Reef',
   'Located next to Keelung Island, it''s just a 20-minute boat ride from the dock. Rainbow Reef is a spectacular site with 2 pinnacles covered in colorful whip corals.',
   25.1910875, 121.7888594, 'keelung'),
  ('Lambai Island',
   'Xiao Liuqiu/Lambai is a large Coral Island. Due to its nesting beach, it is home to hundreds of green sea turtles that both snorkelers and Divers can enjoy.',
   22.3404158, 120.3715149, 'xiaoliuqiu'),
  ('Orchid Island',
   'Orchid Island is best known for the Badai Wreck, a Korean lumber-carrying vessel that starts at 26m and descends to 40m deep.',
   22.0435616, 121.548418, 'lanyu'),
  ('Bat Cave',
   'Bat Cave is an excellent site suitable for all experience levels!',
   25.126318, 121.8321152, 'keelung');

commit;
