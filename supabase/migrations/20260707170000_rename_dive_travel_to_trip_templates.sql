-- Rename the `dive_travel` reference table to `trip_templates` end to end.
--
-- `dive_travel` grew from a Bubble "DiveTravel" transport-blurb table into the
-- reusable set of trip copy a dive links to (included / not_included /
-- transportation / itinerary / prerequisites / links). `trip_templates` says
-- what it is: a template of trip detail a dive event references via
-- events.trip_template_id. It also frees the "travel" word, which collided with
-- `travel_destinations` (the dive-location catalog) and Scheduled Trips.
--
-- App isn't deployed, so this is a clean rename with no back-compat shim: the
-- `DiveTravel` compat view (a Wix reader) is DROPPED — Wix is cut over off this
-- table. Historical migrations keep the old name (they run before this one);
-- only the live objects move.

begin;

-- ── 1. table ─────────────────────────────────────────────────────────────────
alter table public.dive_travel rename to trip_templates;

-- ── 2. RLS policies (current names set by 20260707130000) ────────────────────
alter policy "dive_travel: public select" on public.trip_templates rename to "trip_templates: public select";
alter policy "dive_travel: admin insert"  on public.trip_templates rename to "trip_templates: admin insert";
alter policy "dive_travel: admin update"  on public.trip_templates rename to "trip_templates: admin update";
alter policy "dive_travel: admin delete"  on public.trip_templates rename to "trip_templates: admin delete";

-- ── 3. events FK column + constraint ─────────────────────────────────────────
-- The EO_dives compat view's internal reference to this column follows the
-- rename automatically (Postgres tracks the dependency by column, not name);
-- its external output alias "DiveTravel_reference" is unchanged.
alter table public.events rename column divetravel_id to trip_template_id;
alter table public.events rename constraint events_divetravel_id_fkey to events_trip_template_id_fkey;

-- ── 4. Wix-sync trigger (auto-followed the table rename; rename to match) ─────
alter trigger wix_sync_dive_travel on public.trip_templates rename to wix_sync_trip_templates;

-- ── 5. drop the DiveTravel compat view (Wix cutover off this table) ──────────
drop view if exists public."DiveTravel";

commit;

notify pgrst, 'reload schema';
