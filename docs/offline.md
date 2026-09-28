# Offline: the day board on a boat

The logistics day board is the surface staff read while loading a van or
standing on a dock, which is exactly where the signal goes. Today's board is
kept on the device so it still reads with no connection.

**Only today.** The capture used to hold ten days. That cost about ninety
requests on sign-in and every fifteen minutes after, on every staff page, and
it slowed the app down for a case — reading next week's roster on a boat —
nobody had. A day other than today reads with no signal only while it is still
on screen: losing the connection keeps the loaded board rather than replacing
it with a "not saved" notice.

**Read-only, except the pack list.** Nothing else queues for later — no
recording a payment, no editing sizes; those fail as they always have when a
write can't reach the server. Ticking gear onto the van keeps working: each
tick is queued on the device and sent when the connection comes back (see
[admin.md](./admin.md#gear-the-pack-checklist)).

**Staff and admin only.** A diver's phone never captures anything; their
surfaces stay online-only.

## Why not the service worker

`sw-cache-policy.ts` refuses to cache any Supabase response carrying an
`Authorization` header. That rule came out of audit H4: an authenticated
`/rest/v1/*` response is RLS-scoped to whoever asked for it, so a cached copy
served offline would hand the previous user's rows to whoever opens the app next
on the same device.

That rule stays. This feature answers the same objection differently:

- the stored record names the user who captured it, and `isUsableSnapshot()`
  refuses a mismatch before anything is read out of it;
- `OfflineProvider` re-checks the id on every render, so React state from a
  previous session is never exposed even for the tick before the effect runs;
- `signOut()` deletes the database, beside the existing SW-cache clear and the
  registration-draft clear.

There is a second reason. An HTTP cache is keyed by URL, so what it holds is
"whatever you happened to look at, if the query string matched exactly". A staff
member who never opened Thursday would find Thursday missing on Thursday. An
explicit capture covers a stated window and can say *when* it was taken.

## What is stored

One record, in IndexedDB (`fundive-offline` → `snapshots` → `day-board`), holding
today:

| | |
| --- | --- |
| `boards[day]` | one `DayBoardData` per day — events, bookings, duties, add-on titles, profiles, payments, credits, amendments |
| `transport[day]` | car allocations and ride groupings |
| `upcomingDays` | the day picker's list, over its own longer 30-day window, so day three is still reachable with no signal |
| `vehicles`, `gearModels` | the fleet and the sizing charts, identical every day |
| `userId`, `capturedAt`, `version` | who captured it, when, and against which shape |

IndexedDB rather than `localStorage`: a busy day is hundreds of rows, and
`localStorage` is synchronous — writing it on the main thread would jank the
board it exists to serve.

### What is deliberately not stored

`redactProfileForOffline()` reduces every diver's row to the operational fields
before it is written. A phone that leaves the shop and never comes back does not
carry:

- `medical_notes`
- `id_number`, `date_of_birth`, `nationality`
- `emergency_contact_name`, `emergency_contact_phone`
- `email`, `avatar_url`, and every certification-card path

It keeps name, sizes, gear owned, certification level and agency, the
nitrox/deep flags, logged dives, and contact method + handle — enough to pack a
van and call a roster.

The fields are **enumerated**, not filtered out of a spread. A column added to
`profiles` later fails this file's typecheck until somebody decides which side of
the line it belongs on; a silent default is how PII ends up on devices nobody
meant to put it on.

One visible consequence: the gear-fit lookup uses `date_of_birth` to route
under-13s to the kids' sizing charts, so offline it falls back to the diver's
recorded gender. It is a fit suggestion, not a safety gate. The board says as
much — the offline banner names what was left behind and tells staff to
reconnect for it.

## How a capture runs

`OfflineProvider` wraps `StaffOrAdminRoute` — the narrowest wrapper every staff
and admin page passes through and no diver page does. A snapshot that only
refreshed while somebody happened to have the logistics board open would be
missing the moment it mattered.

It captures in the background ten seconds after sign-in — the page the user
landed on loads first — then whenever `online` fires and on a fifteen-minute
timer. Each of those is **skipped while today's copy is under thirty minutes
old**, so most of them cost nothing. The board's **Save now** button always
captures. One capture at a time; the timer, the online event and the button can
all fire at once.

A capture whose board read fails throws, and the provider keeps the copy it
already had: with one day stored, an empty board written over a good one is how
staff end up on a boat with nothing. Stale beats none, and the board labels it.
A failed transport, fleet or sizing-chart read is stored empty instead — the
roster is the part that has to be there.

**A finished capture never reloads the board.** The page reads the saved copy
through a ref, so a background save landing on a board that came off the network
changes nothing on screen. A new copy replaces what is shown only when the board
is showing the previous copy, or showing nothing because there was none. Before
this, every capture threw the live board back to the spinner and fetched the
whole day again.

## How a read resolves

`src/lib/day-board-source.ts` is the only place that decides:

```
online?  → try live → success: source 'live'
                    → failure: fall through
offline / failed → snapshot covers this day? → source 'snapshot'
                                             → otherwise null
```

`navigator.onLine` is consulted only to skip a read that is certain to fail. A
browser reporting a connection can still be behind a captive portal or one bar of
signal, so a *failed* live read falls back exactly like a declared offline does.
Nobody standing on a boat gets to toggle a flag first.

Two distinctions the board depends on:

- **null is not an empty board.** Null means "no connection and this day was
  never captured" and renders as exactly that. An empty board means "captured,
  and that day is quiet" and renders as "no events scheduled". Collapsing the two
  would show a confident wrong answer.
- **Transport returns empty rather than null.** A car plan is advisory next to
  the roster; a board without one is still the board.

`liveOrStored()` carries the same fallback for the supporting reads (fleet,
sizing charts, day picker). It *skips* the read when the browser has already said
there is no connection, because supabase-js resolves a query against an
unreachable host as an error *result* rather than a rejection often enough that
catching alone would hand the board an empty fleet and present it as fact.

## Saying so on screen

`OfflineBoardStatus` has two weights on purpose. A board served off the device is
an amber panel — it is a different thing from a live one and has to look like it.
A live board gets one dim line with a **Save now** button, because a status
indicator that shouts on every normal day is one nobody reads on the day it
matters.

The stamp carries the date as well as the time. "Saved at 07:14" on a board last
online yesterday reads as this morning, which is the exact misreading the
indicator exists to prevent.

## Files

| File | What it holds |
| --- | --- |
| `src/lib/offline-db.ts` | the IndexedDB wrapper; every function best-effort, so a browser with IndexedDB disabled gets an online-only board rather than an error |
| `src/lib/offline-snapshot.ts` | the stored shape, the capture, the redaction, the selectors |
| `src/lib/day-board.ts` | `fetchDayBoard` / `fetchDayTransport` — the live reads, extracted from the page so the capture can replay them |
| `src/lib/day-board-source.ts` | the live-or-stored decision |
| `src/hooks/OfflineProvider.tsx` | drives the capture; `useOffline()` reads it |
| `src/components/admin/OfflineBoardStatus.tsx` | the banner |

## What is not covered

Only `/admin/logistics`. The events list, event detail, the gear map and
accounting are online-only. Extending to another surface means giving its loader
the same treatment — extract the reads into a lib, add them to `DayBoardData` (or
a sibling), and route the page through `day-board-source.ts`.

`SNAPSHOT_VERSION` is bumped whenever the stored shape changes. An older
snapshot is discarded rather than migrated; it is a cache, and the next capture
refills it in seconds.
