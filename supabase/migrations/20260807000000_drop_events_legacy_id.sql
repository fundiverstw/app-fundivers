-- Drop events.legacy_id: the Wix cross-reference is not needed.
--
-- Nothing in the app, the edge functions, the push worker or the schema reads
-- it — the only references are its own declaration and the UNIQUE constraint on
-- it. It held the id of the Wix record an event was imported from, which was
-- only ever a migration aid; the shop does not need to trace an event back to
-- Wix, and the outbound-only sync identifies records by other means.
--
-- fundive's schema never had this column, so dropping it also removes one of
-- the differences between the two baselines.
--
-- The UNIQUE constraint goes with the column automatically.

alter table public.events drop column if exists legacy_id;
