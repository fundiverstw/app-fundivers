-- Per-notification "render this body as ASCII art" flag, set by the
-- admin one-off broadcast form. Only meaningful for the in-app inbox
-- view: when true, the diver-side <pre> uses a container-query font-size
-- so an 80-column banner fits within the card on mobile without
-- horizontal scrolling. Default false leaves the behaviour of every
-- other notification kind untouched (reminders, duties, waitlist offers
-- are short text, not banners).
--
-- We add a real column rather than encoding the hint in the body or
-- relying on a heuristic — it's a single bit and the alternatives are
-- either fragile (auto-detect from line lengths) or hacky (magic
-- prefix string).

begin;

alter table public.notifications
  add column if not exists is_ascii_art boolean not null default false;

commit;
