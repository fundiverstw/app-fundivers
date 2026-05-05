-- public."TravelDestinations" + public.eo_dive_destinations.
--
-- TravelDestinations is the catalog of dive locations referenced by
-- EO_dives.destination_reference. The column is declared text and stores
-- a Wix-style multi-reference value: a JSON array of destination ids
-- (e.g. '["uuid-1", "uuid-2"]'). Same shape as the other_addons column
-- already normalised by 20260422220000_event_addons_junction.sql, so we
-- mirror that pattern: keep the legacy text column on EO_dives as the
-- Wix-sync buffer, mirror its contents into a junction table for real
-- FK joins in the SPA.
--
-- Seed data is the 24-row CSV exported from the live Wix collection;
-- the rich-text Wix description blobs ("Page Description", "How to Get
-- there", etc.) are deliberately not imported -- only the scalar fields
-- the SPA actually needs. Column names match the Wix CSV headers where
-- it matters ("Created Date", "Updated Date", "Owner") so a re-import
-- drops in cleanly, otherwise snake_case.
--
-- No wix_sync_* trigger is added: data flows Wix -> Supabase as a
-- one-time import, not the other way.

begin;

-- 1. TravelDestinations table
create table public."TravelDestinations" (
  _id                 text primary key,
  title               text,
  slug                text,
  tagline             text,
  country             text,
  divetype            text,
  sort_order          integer,
  latitude            numeric,
  longitude           numeric,
  international       boolean,
  northeast_diving    boolean,
  location_picture    text,
  background_picture  text,
  diver_requirements  text,
  "Created Date"      timestamptz not null default now(),
  "Updated Date"      timestamptz not null default now(),
  "Owner"             text
);

-- 2. Seed 24 rows from the Wix TravelDestinations CSV export
insert into public."TravelDestinations" (
  _id, title, slug, tagline, country, divetype, sort_order,
  latitude, longitude, international, northeast_diving,
  location_picture, background_picture, diver_requirements,
  "Created Date", "Updated Date", "Owner"
) values
  ('b718703b-b6d6-43ff-b56e-f886ed67d9c5', 'Lambai Island', '/traveldestinations/lambai-island', 'Xiao Liuqiu/Lambai is a large Coral Island. Due to its nesting beach, it is home to hundreds of green sea turtles that both snorkelers and Divers can enjoy.', 'Taiwan', null, 1, 22.34, 120.44, null, null, 'wix:image://v1/b37fef_1bd8b45dfdd84c2092af24957897caf6~mv2.jpg/P7010807_edited.jpg#originWidth=845&originHeight=1062', 'wix:image://v1/b37fef_0dbc54b500c1469ebddb0aa25bb616a2~mv2.jpg/P1010338_edited.jpg#originWidth=1883&originHeight=576', 'Open water diver (Advanced certification and SMB are recommended for all boat diving)', '2019-01-26T09:05:58Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('52224a76-927a-4e3e-8c52-2d34afacbdf0', 'Kenting', '/traveldestinations/kenting', 'Kenting has been a top dive destination in Taiwan for decades. It is best known for its myriad of corals that are plastered atop the reef.', 'Taiwan', null, 2, 21.9, 120.7, null, null, 'wix:image://v1/b37fef_87e95d0417b44597b86897cf2825a07f~mv2.jpg/nudi%20purple%20orange%20white_edited.jpg#originWidth=1167&originHeight=1428', 'wix:image://v1/b37fef_d942279a944e4400b470554326dfebd0~mv2.jpg/PA030126_edited.jpg#originWidth=1882&originHeight=797', 'Open water diver (Advanced certification and SMB are recommended for all boat diving)', '2019-01-26T09:05:58Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('6c8ea96c-afb2-4244-9f3e-a2e6cd040788', 'Green Island', '/traveldestinations/green-island', 'Green Island is located off the coast of Taitung, on the southeast coast of Taiwan. It is a favorite dive destination for many locals. Renowned for its impressive visibility, which can reach up to 30-40m, it is ideal for photography enthusiasts.', 'Taiwan', null, 3, 22.67620740507185, 121.47133243884599, null, null, 'wix:image://v1/b37fef_60f0aee8faef48e7bd0853c51f83f84a~mv2.jpg/dennis%20and%20mailbox.jpg#originWidth=4008&originHeight=3008', 'wix:image://v1/b37fef_53e97ce36e174ccf9fcc03bfed72c939~mv2.jpg/P1300147_edited.jpg#originWidth=1883&originHeight=632', 'Open water diver (Advanced certification and SMB are recommended for all boat diving)', '2019-01-27T14:56:34Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('b2c76485-d2b5-4be1-a47a-84e109020ed1', 'Palau', '/traveldestinations/palau', 'Palau is an archipelago located in Micronesia, in the western Pacific Ocean. It is a world-class diving experience that draws divers from all over the globe. It is a top ten destination and a must-see for all avid divers.', 'Palau', null, 4, null, null, true, null, 'wix:image://v1/b37fef_9298b088838f4473a34fb0404021de71~mv2.jpg/FD%20Plane.jpg#originWidth=1883&originHeight=1062', 'wix:image://v1/b37fef_7844696823294ad6851a97028f1694b5~mv2.jpg/gray%20reef%20shark%20Palau.jpg#originWidth=1024&originHeight=768', 'Open water diver (Advanced certification and SMB are recommended for all boat diving)', '2020-01-16T04:14:55Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('1a7fefc1-dbd4-4ef8-bcc3-aff99e098558', 'Penghu', '/traveldestinations/penghu', 'Of all the dive locations in Taiwan, Penghu has the most fish in numbers, size, and diversity! If you have the experience and time, it’s a definite must-see!', 'Taiwan', null, 5, 23.25, 119.5, null, null, 'wix:image://v1/b37fef_c3c0324de5bb47b49843a8f63551b4e7~mv2.jpg/Penghu%20Hearts%20enhanced.jpg#originWidth=1734&originHeight=1301', 'wix:image://v1/b37fef_140ba06f950d4da6b30f5775b9b7649d~mv2.jpg/P1010595_edited.jpg#originWidth=1883&originHeight=823', 'Advanced diver with 50 dives experience and able to use a DSMB.', '2021-01-10T12:42:18Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('b8d64fe7-d7c2-487a-b4a0-9899d014bb9b', 'Orchid Island', '/traveldestinations/orchid-island', 'Orchid Island is best known for the Badai Wreck, a Korean lumber-carrying vessel that starts at 26m and descends to 40m deep.', 'Taiwan', null, 6, 22.02, 121.6, null, null, 'wix:image://v1/b37fef_51df0bc6686a40829cad1eb790acb3cf~mv2.jpg/Orchid%20Island%20Boats.jpg#originWidth=1024&originHeight=685', 'wix:image://v1/b37fef_d207e4580aa545bcbe41dd581620272e~mv2.jpg/P5070145.jpg#originWidth=1883&originHeight=1062', 'Open water diver (Advanced and Deep certification and SMB are recommended for all boat diving)', '2021-02-07T11:07:16Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('641708ec-f466-4225-9160-5ba10051432b', 'Tubbataha', '/traveldestinations/tubbataha', null, 'The Philippines', null, 7, null, null, true, null, null, null, 'Open water diver (Advanced certification and SMB are recommended for all boat diving)', '2025-02-11T03:04:08Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('c766531e-7560-4cff-917f-f51c8ce472a0', 'Anilao', '/traveldestinations/anilao', 'Just a few hours from Manila, in the Batangas Province, lies Anilao. Anilao has long been considered one of the best diving spots in the Philippines, attracting both beginners and experienced divers. The proximity to Manila is one of the reasons Anilao has become such a popular destination for both local and international divers.', 'The Philippines', null, 8, null, null, true, null, 'wix:image://v1/b37fef_75d44200c3b74bdf862662f4d9bb41c3~mv2.jpg/20230124_080229-Longtail%20Boat-Anilao.jpg#originWidth=3964&originHeight=2230', 'wix:image://v1/b37fef_910b82e1e0914504b8ae73cfd1ce8bf4~mv2.jpg/P1251018-Peacock%20Mantis%20Shrimp-Anilao.jpg#originWidth=3638&originHeight=2046', 'Open water diver (Advanced certification and SMB are recommended for all boat diving)', '2025-02-11T03:04:08Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('057b98dc-6d82-40ac-be20-c49e81387ddc', 'Puerto Galera', '/traveldestinations/puerto-galera', 'Puerto Galera is a top dive destination in the Mindoro Province of the Philippines.  It offers exciting nightlife and restaurants serving Western or Filipino cuisine. ', 'The Philippines', null, 9, null, null, true, null, 'wix:image://v1/b37fef_b44cd4fc93024ca686aedca9e5fda4b9~mv2.jpg/S__39518252_0.jpg#originWidth=4032&originHeight=3024', 'wix:image://v1/b37fef_2de7ba238022402a87425187c6ef1375~mv2.jpg/S__39518251_0.jpg#originWidth=4032&originHeight=3024', 'Advanced Open Water Certification is recommended and Deep Specialty is required to reach some of the deeper sites.', '2025-06-12T03:34:48Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('7fac8c9e-03c8-4ae0-9ac9-94f14747785a', 'Panglao, Bohol', '/traveldestinations/panglao%2C-bohol', 'Panglao is a diver’s paradise with a variety of dive sites and an abundance of sea life!  Located in the Bohol Province of the Philippines, it is on the list of must-see places for all divers!', 'The Philippines', null, 10, null, null, true, null, 'wix:image://v1/b37fef_88e3586799e14af8946b2672f6384617~mv2.jpg/S__11411539_0.jpg#originWidth=1570&originHeight=1042', 'wix:image://v1/b37fef_314c4d8b5ff74e39b8d0c56c04c13c8c~mv2.jpg/S__11411536_0.jpg#originWidth=1570&originHeight=1042', 'AOW Certification recommended so you can visit some of the deeper sites. However, there several sites that are accessible to OW certified divers.', '2025-06-12T04:06:56Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('f2ed912b-71f5-4b24-9122-eb00f6a206ae', 'Bat Cave', '/traveldestinations/bat-cave', 'Bat Cave is an excellent site suitable for all experience levels!', 'Taiwan', 'Shore Diving', 11, 25.14, 121.82, null, true, 'wix:image://v1/b37fef_f6fcbc5a749741af99c3fef4b8ea7a9d~mv2.jpg/P1010167.jpg#originWidth=1883&originHeight=1062', 'wix:image://v1/b37fef_5262bdc1e0354c11ab24215c34437958~mv2.jpg/P1010330.jpg#originWidth=1883&originHeight=1062', 'All levels of divers', '2025-11-29T10:37:37Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('9cbfd600-7a90-470b-b9c9-93d5efbc3bff', 'Long Dong Bay', '/traveldestinations/long-dong-bay', 'Long Dong Bay has a walk-in ramp that makes it easy for entering and exiting when the conditions are calm. Perfect for beginners and advanced Divers alike.', 'Taiwan', 'Shore Diving', 12, 25.13, 121.93, null, true, 'wix:image://v1/b37fef_e2975ca5e18b4669a1f480a8c20ba872~mv2.jpg/P9230208.jpg#originWidth=3464&originHeight=1954', 'wix:image://v1/b37fef_cb6c989d93ac4f2b95577206e0cdb327~mv2.jpg/P9230200.jpg#originWidth=3404&originHeight=1920', 'All levels', '2025-11-29T10:37:37Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('2e0578b9-0572-4d6a-b682-2de69fb4b9a4', 'Secret Garden', '/traveldestinations/secret-garden', 'Secret Garden is a favorite among local divers. With its garden of sea fans, whip, and soft coral. It is truly a must-see site on the Northeast Coast of Taiwan.', 'Taiwan', 'Shore Diving', 13, 25.22, 121.71, null, true, 'wix:image://v1/b37fef_1d51bc48dbe64b13974e2e42cc5a0eb0~mv2.jpg/P1010753.jpg#originWidth=1883&originHeight=1062', 'wix:image://v1/b37fef_2c00441033924be09fcc690fa29da304~mv2.jpg/P1010765.jpg#originWidth=1732&originHeight=1155', 'Advanced Certified with shore diving experience', '2025-11-29T10:37:37Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('70c3b0f3-3f03-4349-8dc1-04e362653493', 'Canyons', '/traveldestinations/canyons', 'An interesting site with beatiful slopes, walls, and boulders to explore. ', 'Taiwan', 'Shore Diving', 14, 25.13, 121.91, null, true, 'wix:image://v1/b37fef_d9cab6f1c752479098c35ed5d6901280~mv2.jpg/P7190077.jpg#originWidth=4000&originHeight=3000', 'wix:image://v1/b37fef_6057832d6802444c880400ac473e1a9a~mv2.jpg/P8250154.jpg#originWidth=4000&originHeight=3000', 'Advanced Open Water Divers with shore diving experience', '2025-11-29T10:37:37Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('8bc71962-9638-4a30-91a8-817c672ca48b', '82.5', '/traveldestinations/82.5', 'The wall here at 82.5 always has interesting creatures and rock formations to observe.', 'Taiwan', 'Shore Diving', 15, 25.13, 121.9, null, true, 'wix:image://v1/b37fef_845ffda9d96b4f24bf1083f369cd850c~mv2.jpg/P1010109.jpg#originWidth=1331&originHeight=751', 'wix:image://v1/b37fef_199df5c07e5f49dda4509a5b73e3e24b~mv2.jpg/P1020651.jpg#originWidth=1732&originHeight=1155', 'Advanced Open Water Divers with shore diving experience', '2025-11-29T10:37:37Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('b2627255-fb70-4193-a686-bc251f0d6340', 'Rainbow Reef', '/traveldestinations/rainbow-reef', 'Located next to Keelung Island, it’s just a 20-minute boat ride from the dock. Rainbow Reef is a spectacular site with 2 pinnacles covered in colorful whip corals.', 'Taiwan', 'Boat Diving', 16, 25.24, 121.69, null, true, 'wix:image://v1/b37fef_8b2bae6712a644cfa0464e7420bc3597~mv2.jpg/PA090566.jpg#originWidth=1883&originHeight=1062', 'wix:image://v1/b37fef_1f0c63e9ebd843848753b23ca95f585d~mv2.jpg/P7040241.jpg#originWidth=1331&originHeight=751', 'Advanced Open Water Divers with Enriched Air Nitrox', '2025-11-29T10:37:37Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('adf55491-0aaa-49bd-bf0a-8affba1a0ce0', 'Wan An Jian Navy Wreck', '/traveldestinations/wan-an-jian-navy-wreck', 'Wan An Jian is a massive navy wreck covered in life and surrounded by schools of fish located off the east coast of Taiwan.', 'Taiwan', 'Boat Diving', 17, 24.89, 121.92, null, true, 'wix:image://v1/b37fef_e6233d5e9ab746e88cc2054e58642ec5~mv2.jpg/P1010153.jpg#originWidth=1731&originHeight=1154', 'wix:image://v1/b37fef_21175648b3544e82b83b61f178570722~mv2.jpg/Wan%20An%20Jian%202.jpg#originWidth=1883&originHeight=1059', 'Advanced Open Water Divers with Enriched Air Nitrox (Deep Certification Recommended)', '2025-11-29T10:37:37Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('8e938f1a-6a40-442b-97e7-bfbb624e04cf', 'Badouzi Bay: Crystal Temple Wall', '/traveldestinations/badouzi-bay%3A-crystal-temple-wall', 'A 100m stretch of wall starting at 15m down to 30m.', 'Taiwan', 'Boat Diving', 18, 25.19, 121.77, null, true, 'wix:image://v1/b37fef_1d060fa54c0a447ebfedc5d6c34f78fc~mv2.jpg/P6260401.jpg#originWidth=1154&originHeight=866', 'wix:image://v1/b37fef_47ae5c5d39cb4212a3a21532c4311514~mv2.jpg/PA058129.jpg#originWidth=4026&originHeight=3008', 'Advanced Open Water Divers with Enriched Air Nitrox', '2025-11-29T10:37:37Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('7476fcb5-6a32-4c66-9c8b-46c0af2af201', 'Iron House 2', '/traveldestinations/iron-house-2', 'Iron House 2 has 2 metal frame structures side by side shaped like square building blocks teeming with life.', 'Taiwan', 'Boat Diving', 19, 25.14, 120.81, null, true, 'wix:image://v1/b37fef_60ddb1f8b0a54547a9ce4b45f18c2715~mv2.png/P9280361_edited.png#originWidth=1883&originHeight=562', 'wix:image://v1/b37fef_ee093b88a6734769bb0bbc0a9f49b50f~mv2.jpg/P1010326.jpg#originWidth=1883&originHeight=1062', 'Advanced Open Water Divers with Enriched Air Nitrox (Deep Certification Recommended)', '2025-11-29T10:37:37Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('71077d4f-2d3a-4696-9207-761b81522965', 'Badouzi Bay: Shipwrecks', '/traveldestinations/badouzi-bay%3A-shipwrecks', 'With many shipwrecks sparsely placed in the vicinity of Badouzi Bay, scuba divers have a fantastic opportunity to explore these fishing vessels that have now become artificial reefs.', 'Taiwan', 'Boat Diving', 20, 25.2, 121.74, null, true, 'wix:image://v1/b37fef_48516a4e92fa43398e849382d8ae002e~mv2.jpg/Eric%20and%20Cabin.jpg#originWidth=4026&originHeight=3008', 'wix:image://v1/b37fef_fb9cfa8d2dfb4a3baf613ed377271a57~mv2.jpg/Moray%20Closeup.jpg#originWidth=4026&originHeight=3008', 'Advanced Open Water Divers with Enriched Air Nitrox', '2025-11-29T10:37:37Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('5df240ae-05e0-48f3-8772-84cb63c90fc0', 'Cathedral', '/traveldestinations/cathedral', 'The Cathedral is a unique dive site suitable for all levels of Divers and is always full of surprises!', 'Taiwan', 'Boat Diving', 21, 25.06, 121.96, null, true, 'wix:image://v1/b37fef_757bf97dabf14263bb215a8b4f7848f8~mv2.jpg/P9280413.jpg#originWidth=1883&originHeight=1062', 'wix:image://v1/b37fef_cf65c102ff75412c9d9e33ef05bcaa72~mv2.jpg/P1010233.jpg#originWidth=1883&originHeight=1062', 'All levels', '2025-11-29T10:37:37Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('2f20780e-0a57-41c3-b941-275e1d2a1d7e', 'Turtle Island', '/traveldestinations/turtle-island', 'Turtle Island is known to Divers for the site called Milky Way, an underwater hot spring. If you get this rare opportunity to dive there, you must try it!', 'Taiwan', 'Boat Diving', 22, 24.84, 121.97, null, true, 'wix:image://v1/b37fef_08800163ce0a42eb9cecfbf26133c457~mv2.jpg/PA040357.jpg#originWidth=1882&originHeight=1061', 'wix:image://v1/b37fef_5107772b73ce4473bb57a6b54e2a418d~mv2.jpg/P1010193.jpg#originWidth=1883&originHeight=1062', 'Open Water Divers', '2025-11-29T10:37:37Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('1a4af779-9afb-4d91-87a2-9fbd97d3d2ca', 'Badouzi Bay: Iron House / Iron Reef', '/traveldestinations/badouzi-bay%3A-iron-house-%2F-iron-reef', 'These are artificial reefs made of steel shaped like the framework of houses. Within its confines, reside an array of fish using them as protection from predators such as the amberjacks.', 'Taiwan', 'Boat Diving', 23, 25.19, 121.73, null, true, 'wix:image://v1/b37fef_2017559b29b447eea2e1fb906ace863f~mv2.jpg/P6151306.jpg#originWidth=4026&originHeight=3008', 'wix:image://v1/b37fef_c7dfe12c9d3e407b858a980ca15ba8bf~mv2.jpg/Iron%20House%202.jpg#originWidth=2100&originHeight=1400', 'Advanced Open Water Divers with Enriched Air Nitrox', '2025-11-29T10:37:37Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572'),
  ('170af4c1-98ec-4b7a-8a89-fd367343f13f', 'Cauliflower Garden', '/traveldestinations/cauliflower-garden', 'Cauliflower Garden is a charming wall dive with lovely little, colorful, soft corals shaped like cauliflower.', 'Taiwan', 'Boat Diving', 24, 24.92, 121.92, null, true, 'wix:image://v1/b37fef_ff042e91927d4e8695e4cbd811fdc2a5~mv2.jpg/P9280363.jpg#originWidth=1883&originHeight=1062', 'wix:image://v1/b37fef_8e1e8049bc504c54ad2835b86630c42c~mv2.jpg/P1010213.jpg#originWidth=1732&originHeight=1155', 'Advanced Open Water Divers with Enriched Air Nitrox', '2025-11-29T10:37:37Z', '2026-04-30T00:27:37Z', 'b37fefa3-09b1-4e00-a824-f6b884e43572');

-- 3. RLS: public-read so the wix-site iframe (anon key) and the SPA can
--    join, admin-write so only admins can mutate. Mirrors DiveTravel.
alter table public."TravelDestinations" enable row level security;

drop policy if exists "TravelDestinations: public select" on public."TravelDestinations";
drop policy if exists "TravelDestinations: admin insert" on public."TravelDestinations";
drop policy if exists "TravelDestinations: admin update" on public."TravelDestinations";
drop policy if exists "TravelDestinations: admin delete" on public."TravelDestinations";

create policy "TravelDestinations: public select"
  on public."TravelDestinations" for select to anon, authenticated using (true);
create policy "TravelDestinations: admin insert"
  on public."TravelDestinations" for insert to authenticated
  with check (public.is_admin());
create policy "TravelDestinations: admin update"
  on public."TravelDestinations" for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());
create policy "TravelDestinations: admin delete"
  on public."TravelDestinations" for delete to authenticated
  using (public.is_admin());

-- 4. Junction table for the EO_dives <-> TravelDestinations many-to-many
--    relation. EO_dives._id is uuid (post 20260426000000_eo_uuid_ids);
--    TravelDestinations._id is text to match the Wix UUID-string format.
create table public.eo_dive_destinations (
  eo_dive_id     uuid not null references public."EO_dives"(_id)             on delete cascade,
  destination_id text not null references public."TravelDestinations"(_id) on delete cascade,
  primary key (eo_dive_id, destination_id)
);

create index eo_dive_destinations_destination_idx
  on public.eo_dive_destinations (destination_id);

-- 5. Backfill from existing EO_dives.destination_reference JSON arrays.
--    We reuse public.parse_addon_ids (defined in 20260422220000) -- the
--    name is legacy but the function is generic (text -> setof text,
--    JSON-or-CSV with tolerant fallback). Orphan ids referencing
--    destinations that aren't in TravelDestinations are filtered out
--    (the FK would reject them anyway), matching the addons backfill.
insert into public.eo_dive_destinations (eo_dive_id, destination_id)
select d._id, elem
from public."EO_dives" d
cross join lateral public.parse_addon_ids(d.destination_reference) as elem
where exists (select 1 from public."TravelDestinations" t where t._id = elem)
on conflict do nothing;

-- 6. Sync trigger: keep the junction in step with destination_reference
--    on every EO_dives insert/update. DELETE-then-reinsert mirrors the
--    addon trigger and keeps the logic trivially correct.
create or replace function public.sync_eo_dive_destinations() returns trigger
  language plpgsql as $$
begin
  delete from public.eo_dive_destinations where eo_dive_id = new._id;
  insert into public.eo_dive_destinations (eo_dive_id, destination_id)
  select new._id, elem
  from public.parse_addon_ids(new.destination_reference) as elem
  where exists (select 1 from public."TravelDestinations" t where t._id = elem)
  on conflict do nothing;
  return new;
end;
$$;

create trigger sync_eo_dive_destinations_trg
  after insert or update of destination_reference on public."EO_dives"
  for each row execute function public.sync_eo_dive_destinations();

-- 7. RLS on the junction. Public-read so the SPA can join, admin-write
--    is academic since the trigger is the only writer in practice but
--    we lock it down for parity with the addon junctions.
alter table public.eo_dive_destinations enable row level security;

drop policy if exists "eo_dive_destinations: public select" on public.eo_dive_destinations;
drop policy if exists "eo_dive_destinations: admin insert" on public.eo_dive_destinations;
drop policy if exists "eo_dive_destinations: admin update" on public.eo_dive_destinations;
drop policy if exists "eo_dive_destinations: admin delete" on public.eo_dive_destinations;

create policy "eo_dive_destinations: public select"
  on public.eo_dive_destinations for select to anon, authenticated using (true);
create policy "eo_dive_destinations: admin insert"
  on public.eo_dive_destinations for insert to authenticated
  with check (public.is_admin());
create policy "eo_dive_destinations: admin update"
  on public.eo_dive_destinations for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());
create policy "eo_dive_destinations: admin delete"
  on public.eo_dive_destinations for delete to authenticated
  using (public.is_admin());

commit;
