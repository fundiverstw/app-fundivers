-- Drop events.second_image: write-only dead weight.
--
-- The admin event form captured it and every save round-tripped it, but nothing
-- ever displayed it. `featured_image` is the only event photo the app renders
-- (the dashboard's featured card, via resolveImageUrl); second_image was never
-- even selected in EVENT_COLS, so no diver or admin surface could show it.
--
-- No view, RPC or constraint depends on the column. create_events_atomically
-- builds its row with jsonb_populate_record, which ignores payload keys that
-- have no matching column, so the drop needs no function rewrite.

alter table public.events drop column if exists second_image;
