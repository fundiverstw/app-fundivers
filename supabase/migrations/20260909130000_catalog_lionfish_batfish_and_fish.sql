-- Three entries the almanac's own history asked for.
--
-- The backfill that moved the old free text onto taxa left four labels
-- unmatched, and three of them are animals divers really do report at exactly
-- that resolution:
--
--   "lionfish"  — the genus Pterois. Somebody who writes "lionfish" has not
--                 said which of them it was, and filing it as P. volitans
--                 would be inventing an identification they did not make.
--   "batfish"   — Ephippidae. In this ocean that is Platax, and every diver
--                 who says batfish means one of them.
--   "small schools of fish" — not an identification of anything, but not
--                 nothing either: fish were seen and nothing more was claimed.
--                 Actinopterygii is that statement at its honest rank, which
--                 is what having ranks is for. It is the coarsest entry in the
--                 catalog and it should stay rare.
--
-- Reference data, so both repos carry it: none of these three is specific to
-- this shop, and a fork whose divers write "lionfish" hits the same gap.
insert into public.taxa (rank, scientific_name, parent_id)
select v.rank, v.scientific_name, p.id
from (values
  ('class', 'Actinopterygii', null),
  ('family', 'Ephippidae', null),
  ('genus', 'Pterois', 'Scorpaenidae')
) as v(rank, scientific_name, parent_name)
left join public.taxa p on lower(p.scientific_name) = lower(v.parent_name);

insert into public.taxon_names (taxon_id, lang, name, is_primary)
select t.id, v.lang, v.name, v.is_primary
from (values
  ('Actinopterygii', 'en', 'ray-finned fish', true),
  ('Actinopterygii', 'ja', '条鰭類', true),
  ('Actinopterygii', 'zh-TW', '條鰭魚', true),
  ('Ephippidae', 'en', 'batfish', true),
  ('Ephippidae', 'en', 'spadefish', false),
  ('Ephippidae', 'ja', 'ツバメウオ科', true),
  ('Ephippidae', 'zh-TW', '白鯧科', true),
  ('Pterois', 'en', 'lionfish', true),
  ('Pterois', 'ja', 'ミノカサゴ', true),
  ('Pterois', 'zh-TW', '蓑鮋', true)
) as v(scientific_name, lang, name, is_primary)
join public.taxa t on lower(t.scientific_name) = lower(v.scientific_name);

-- The species moves under its genus now that the genus exists. The lineage
-- trigger checks that a species hung on a genus is the genus its own name
-- starts with, so this is the arrangement it was written for.
update public.taxa
   set parent_id = (select id from public.taxa where scientific_name = 'Pterois')
 where scientific_name = 'Pterois volitans';
