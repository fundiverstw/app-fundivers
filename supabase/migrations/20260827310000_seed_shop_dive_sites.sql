-- The shop's own map, loaded into the catalog.
--
-- Shop content, not app code: a fork of FunDive gets the empty catalog and
-- seeds its own coastline. These are FunDivers' 24 places, names and
-- coordinates taken verbatim from the ones the public site has been publishing
-- (site-fundivers, src/content/dive-sites) — which is where they ended up
-- after this table was dropped and rebuilt, so this returns them to the
-- database that first held them.
--
-- This is the first and best of the three anti-duplicate defences. A diver
-- looking for Bat Cave who cannot find it types one in; a diver who finds
-- 蝙蝠洞 already waiting does not. Most sites people "add" are not new.
--
-- Reconciling, not inserting blind. Some of these are already in the catalog
-- under a name an admin typed, so a plain INSERT would create exactly the
-- duplicates this whole change is about. Matched on the same normalized key
-- the search uses, so an existing "Iron House 2" is filled in rather than
-- twinned. The existing spelling stays the row's name — events and
-- observations already point at that row and people recognise it by that name
-- — and the seed's spelling is kept as an alias so searching for it lands
-- there too.
--
-- One statement on purpose. The obvious shape is a temporary table, and a
-- temporary table with ON COMMIT DROP quietly depends on the whole file being
-- one transaction; run statement by statement it disappears before the next
-- line can read it.
with seed (name, name_zh_tw, name_ja, region, latitude, longitude) as (
  values
    ('82.5', '82.5', '82.5', 'longdong', 25.1201875, 121.8996875),
    ('Anilao', '阿尼洛', 'アニラオ', 'anilao', 13.7561, 120.8567),
    ('Bat Cave', '蝙蝠洞', 'バット・ケーブ', 'keelung', 25.126318, 121.8321152),
    ('Canyons', '峽谷', 'キャニオン', 'longdong', 25.1226015, 121.9040652),
    ('Cathedral', '大教堂', 'カテドラル', 'yilan', 25.0328125, 121.9425625),
    ('Cauliflower Garden', '花椰菜花園', 'カリフラワー・ガーデン', 'yilan', 24.9811625, 121.9658281),
    ('Crystal Temple Wall', '水晶宮牆', 'クリスタル・テンプル・ウォール', 'keelung', 25.1358875, 121.8182969),
    ('Green Island', '綠島', '緑島', 'greenisland', 22.6620886, 121.4901443),
    ('Iron House 2', '鐵屋2號', 'アイアンハウス2', 'keelung', 25.1459625, 121.8159844),
    ('Iron House / Iron Reef', '鐵屋／鐵礁', 'アイアンハウス／アイアンリーフ', 'keelung', 25.1429625, 121.8129844),
    ('Kenting', '墾丁', '墾丁', 'kenting', 21.9483307, 120.7797516),
    ('Lambai Island', '拉美島（小琉球）', 'ランバイ島（小琉球）', 'xiaoliuqiu', 22.3404158, 120.3715149),
    ('Long Dong Bay', '龍洞灣', '龍洞湾', 'longdong', 25.1133125, 121.9200625),
    ('Malapascua', '馬拉帕斯瓜', 'マラパスクア', 'malapascua', 11.3208, 124.1156),
    ('Orchid Island', '蘭嶼', '蘭嶼', 'lanyu', 22.0435616, 121.548418),
    ('Palau', '帛琉', 'パラオ', 'palau', 7.3436, 134.479),
    ('Panglao, Bohol', '邦勞島・薄荷島', 'パングラオ島・ボホール', 'panglao-bohol', 9.5787, 123.75),
    ('Penghu', '澎湖', '澎湖', 'penghu', 23.5711899, 119.5793157),
    ('Puerto Galera', '波多加萊拉', 'プエルトガレラ', 'puerto-galera', 13.5127, 120.9647),
    ('Rainbow Reef', '彩虹礁', 'レインボー・リーフ', 'keelung', 25.1910875, 121.7888594),
    ('Secret Garden', '秘密花園', 'シークレット・ガーデン', 'keelung', 25.1434517, 121.8034149),
    ('Shipwrecks', '沉船群', '沈船群', 'keelung', 25.1399625, 121.8099844),
    ('Turtle Island', '龜山島', '亀山島', 'yilan', 24.8423735, 121.9501551),
    ('Wan An Jian Navy Wreck', '萬安艦沉船', '萬安艦（海軍沈船）', 'yilan', 24.9618125, 121.9458125)
),
matched as (
  select d.id as site_id, s.*
    from seed s
    join public.dive_sites d
      on d.kind = 'dive'
     and public.dive_site_match_key(d.name) = public.dive_site_match_key(s.name)
),
filled as (
  update public.dive_sites d
     set name_zh_tw = coalesce(d.name_zh_tw, m.name_zh_tw),
         name_ja    = coalesce(d.name_ja,    m.name_ja),
         region     = coalesce(d.region,     m.region),
         latitude   = coalesce(d.latitude,   m.latitude::numeric(9, 6)),
         longitude  = coalesce(d.longitude,  m.longitude::numeric(9, 6)),
         verified   = true,
         updated_at = now()
    from matched m
   where d.id = m.site_id
  returning d.id
),
aliased as (
  insert into public.dive_site_aliases (site_id, name, locale)
  select m.site_id, m.name, 'en'
    from matched m
    join public.dive_sites d on d.id = m.site_id
   where lower(d.name) <> lower(m.name)
  on conflict do nothing
  returning id
)
insert into public.dive_sites (name, kind, name_zh_tw, name_ja, region, latitude, longitude, verified)
select s.name, 'dive', s.name_zh_tw, s.name_ja, s.region,
       s.latitude::numeric(9, 6), s.longitude::numeric(9, 6), true
  from seed s
 where not exists (
   select 1 from public.dive_sites d
    where d.kind = 'dive'
      and public.dive_site_match_key(d.name) = public.dive_site_match_key(s.name)
 );
