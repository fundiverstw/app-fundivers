-- Private dives: an EO_dive flagged is_private exists in the DB and is fully
-- registerable via a direct link, but is hidden from every diver-facing
-- listing (the in-app diver calendar, the Wix calendar, the Wix "upcoming
-- dives" feed). Admins still see it on the admin calendar with a distinct
-- (dimmed + closed-eye) indicator and share the /register/dive/<id> link
-- directly. Filtering is done in the read paths, not RLS — the catalog is
-- public-read so the direct registration link still resolves the event.

alter table public."EO_dives"
  add column is_private boolean not null default false;
