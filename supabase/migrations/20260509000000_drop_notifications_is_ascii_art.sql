-- The ASCII-art rendering experiment from 20260508000000 didn't pan out:
-- the auto-fit CSS / JS-measured approaches didn't reliably eliminate
-- scroll bars across browsers and OSes. The feature was removed; drop
-- the now-unused column.

begin;

alter table public.notifications drop column if exists is_ascii_art;

commit;
