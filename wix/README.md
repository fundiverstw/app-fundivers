# Wix snippets — fundiverstw.com

Source-of-truth for the JS and HTML that lives **inside** the
fundiverstw.com Wix site. Nothing in this directory is built, bundled,
or imported by the PWA. Files here are copy-pasted into the Wix editor:

- `*.js` → Velo page code or `.web.js` / `.jsw` backend modules
- `*.html` → Wix HTML custom elements (sandboxed iframes)

## Why this directory exists in the app repo

The Wix site reads directly from the same Supabase project that powers
the PWA, via the REST API in `backend/supabase.jsw`. That makes the
relationship one-way:

- **The app does not depend on Wix.** Editing files here, or breaking
  the Wix site entirely, has zero effect on the PWA.
- **Wix depends on the app's database schema.** Every column rename,
  type change, or new table the PWA's migrations introduce is a
  potential break for the snippets in this directory.

Keeping the Wix code beside the migrations that drive it means schema
changes and the corresponding Wix updates can land in the same commit
(or at least the same PR), instead of drifting silently until a visitor
reports something blank on the calendar.

## Workflow when a migration touches a table Wix reads

The Wix site currently reads (via PostgREST) from:

- `EO_dives`, `EO_courses` — calendar rows, upcoming-events lists,
  detail pages
- `EO_prices` — `starting_at` joined onto dives/courses
- `EO_rooms` — room upgrade options
- `DiveTravel` — long-form trip copy (`included`, `not_included`,
  `transportation`, `tagline_text`, `description`, `itinerary`,
  `details`, `picture`)
- `cancellation_policies` — cancellation policy text
- `cert_levels` — prereq cert display names

When a migration in `supabase/migrations/` touches one of these:

1. Update the relevant snippet here (most schema reads are funneled
   through `backend/supabase.jsw` — start there).
2. Open the matching page or HTML element in the Wix editor.
3. Paste the updated file in and **Publish**.
4. Visit the live site (calendar / homepage / details page) and
   confirm nothing went blank.

Step 3 is the load-bearing one. Editing the file in this repo alone
does **nothing** — Wix is still serving the previously pasted copy.

## Layout

- `backend/` — Velo backend modules
  - `supabase.jsw` — every Supabase REST read used by the Wix site,
    plus the reference-flattening helpers (`resolveStartingAt`,
    `resolveRefId`, `resolveRoomOptions`, `wixImageToUrl`, etc.)
  - `sendRequest.web.js` — try-dive / course-info request emails
- `calendar/` — desktop and mobile calendar HTML elements + the Velo
  page script that wires them up. Receives events from
  `getCalendarEvents()` and posts back `book_event` for the PWA
  registration deep-link.
- `home/` — homepage Velo script plus the HTML elements embedded on
  the homepage (upcoming dives card, upcoming courses card, request
  form).
- `upcoming_dives/` — `/upcoming-dives?id=<uuid>` detail page: HTML
  element + Velo script that calls `getDiveById()`.
- `upcoming_courses/` — same shape for courses, calling
  `getCourseById()`.

## Manual re-sync from the CLI

`backend/syncFromSupabase.jsw` exposes `syncFromSupabase()`, which
overwrites every Wix collection in `SYNC_TABLES` with the current
Supabase rows. It's wired to the Velo HTTP function at
`/_functions/syncSupabase`. Hit it any time existing Wix rows need to
be backfilled after:

- Changing the sync pipeline itself (`toWixItem`, `DATE_FIELDS`, …).
  Webhooks only correct future writes; old rows stay wrong until a
  re-sync overwrites them.
- A bulk schema change to a synced table.
- A suspected dropped webhook delivery.

```sh
curl -fsSL -X POST \
  -H 'Content-Type: application/json' \
  -H "x-sync-token: $WIX_SYNC_TOKEN" \
  https://fundiverstw.com/_functions/syncSupabase
```

`WIX_SYNC_TOKEN` is the same token configured on the Supabase webhook
triggers (see the `wix_sync_*` triggers in
`supabase/migrations/20260430153210_remote_schema.sql`). Export it
from `.env.local` rather than pasting it on the command line so it
doesn't land in shell history.

## Cross-origin handoff to the PWA

Wix → PWA navigation uses absolute URLs to
`https://app.fundiverstw.com/register/<dive|course>/<uuid>`. This is
the only contact surface — the PWA never reads anything Wix writes.

Inside an HTML custom element, `wixData` is unavailable and Velo APIs
are off-limits, so each iframe communicates with its host page via
`postMessage`. Conventional message shapes used here:

- `{ type: 'book_event', eventId, eventType }` — calendar tile clicked
- `{ type: 'book', id }` — detail page "Book now" button
- `{ type: 'details_dive' | 'details_course', id }` — homepage card
- `{ type: 'request_submit', requestType, name, email, message }` —
  homepage request form
- `{ type: 'resize', height }` — iframe asking the host to grow

## Known schema gotchas

`EO_dives` and `EO_courses` are Bubble-imported legacy tables (see
`docs/data-model.md`). Foreign keys are sometimes uuid strings,
sometimes JSON-encoded arrays, sometimes populated objects.
`backend/supabase.jsw` already handles all three shapes via
`resolveRefId` — keep using that helper when adding new joins rather
than re-implementing the parsing.

`featured_image` and `picture` columns hold either `wix:image://v1/...`
identifiers (legacy, written by Wix when the row originated there) or
plain `https://` URLs (modern, written by the PWA admin). The
`wixImageToUrl` helper normalizes both.
