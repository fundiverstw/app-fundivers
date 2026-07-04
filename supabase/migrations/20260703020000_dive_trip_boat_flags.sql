-- Two independent admin-set flags on a dive: is_boat_dive and is_trip. They are
-- unrelated — a Kenting boat trip is both, a local day boat dive is only a boat
-- dive, and a Palau liveaboard is only a trip. Previously "trip" and "boat" were
-- conflated (one yellow calendar bucket via dive_outing / title keywords); the
-- Scheduled Trips list needs a real "trip" signal that excludes local boat
-- dives, so we make the two orthogonal.
--
-- Courses are never boat dives or trips, so the flags live on EO_dives only.

begin;

alter table public."EO_dives"
  add column if not exists is_boat_dive boolean not null default false,
  add column if not exists is_trip      boolean not null default false;

-- One-time best-effort backfill from titles so existing dives start with
-- sensible, independent values (admins refine from here). The destination list
-- is a snapshot of fundive.config.ts business.tripKeywords minus the generic
-- "boat" keyword, which now feeds is_boat_dive instead.
update public."EO_dives"
   set is_boat_dive = true
 where coalesce(display_title, admin_title, calendar_title, '') ~* '\yboat\y';

update public."EO_dives"
   set is_trip = true
 where coalesce(display_title, admin_title, calendar_title, '') ~*
   '(green island|kenting|penghu|lambai|xiao\s?liuqiu|orchid island|anilao|palau|panglao|bohol|tubbataha|puerto galera)';

commit;

notify pgrst, 'reload schema';
