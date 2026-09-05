# Running your own shop (forking FunDive)

FunDive is open source. The core app lives upstream (`github.com/fundive/fundive`);
each shop runs a **fork** that supplies only its own configuration and points at
its own Supabase + Cloudflare accounts. This doc is how you stand one up and keep
it current.

## The model: fork + a small set of seam files

You edit a handful of dedicated *seam files*. Everything else is core and you
never touch it — that's what keeps upstream updates conflict-free.

| Seam file | What you put there |
| --- | --- |
| `fundive.config.ts` | Shop name, URLs, locale (timezone/currency/language/units), PWA manifest colors, asset paths, feature toggles, gear list/prices, calendar trip keywords, weather-baseline region. Copy `fundive.config.example.ts` to start. |
| `src/index.css` (`@theme` block) | Your **brand colors** — see [Colors](#colors) below. |
| `src/config/terms.tsx` | Your Terms of Use / privacy text (`TermsContent`). |
| `public/…` (the paths in `assets`) | Your logo, favicon, PWA icons. |
| `.env.local` / `.env.production` | Supabase URL + keys, Turnstile keys, VAPID keys, Cloudflare deploy creds — see [deployment.md](./deployment.md). |
| `wrangler.toml` + `workers/push/wrangler.toml` | The two Worker `name`s (globally unique on Cloudflare), and the push worker's `[vars]` (`VAPID_SUBJECT`, `ALLOWED_ORIGINS`, `TIMEZONE`, `CURRENCY`). |

`fundive.config.ts` is **pure data** — no imports — so it's read identically by
the browser bundle, `vite.config.ts`, the service worker, and the Deno edge
functions. Keep it that way.

### What lives where, and why

- **Config file (`fundive.config.ts`)** — build-time, non-secret, rarely-changed
  values. The build bakes them into the bundle, the PWA manifest, and `index.html`.
- **Env / secrets** — anything per-account or secret (Supabase keys, VAPID,
  Turnstile, Cloudflare token). Never in the config file. See [deployment.md](./deployment.md).
- **Database (admin UI)** — catalog data you edit at runtime: vehicles, dive
  sites, cancellation policies, prices, rooms, add-ons.

### Colors

The whole app is skinned from **one `@theme` block in `src/index.css`**. Tailwind
v4 is CSS-first, so brand colors live there (not in `fundive.config.ts`). Three
token families drive everything:

- `--color-brand-*` — the primary identity (page, nav, buttons, headings, body
  ink). FunDivers' is navy.
- `--color-surface-*` — the light "shallows": card / input borders, subtle fills.
- `--color-accent` — the signature hairline / badge.

They ship aliased to Tailwind's palette (`var(--color-blue-900)` etc.), so the
default build looks like FunDivers. **Re-skin by overriding the values** with any
hex/oklch, e.g.:

```css
@theme {
  --color-brand-900: #0f5132;   /* your primary */
  --color-brand-950: #0a3622;   /* darker variant for nav bars / hovers */
  --color-surface-200: #d1fae5; /* your light surface */
  --color-accent: #f59e0b;      /* your accent */
  /* …override whichever shades your design uses… */
}
```

Every component reads these via `bg-brand-900`, `border-surface-200`,
`border-accent`, etc. (and the semantic helpers in `src/styles/tokens.ts`), so one
edit re-skins the app. Two things stay on the raw Tailwind palette on purpose:
**status colors** (`emerald`=success, `amber`=warning, `red-600`+=danger) so they
stay universally recognizable, and the **categorical event-type palette** (the
OW/AOW/DSD/rescue/specialty rainbow in `MonthCalendar.tsx`, the year-series in
`AdminHistoryPage.tsx`) so re-skinning never collapses those distinct hues.

Keep the PWA manifest colors in `fundive.config.ts` (`theme` / `backgroundColor` —
browser chrome / splash) in sync with your `--color-brand-*` by hand; they're a
separate mechanism (baked into the manifest + `index.html` at build).

### Gear catalog

`business.gearItems` is the one list behind three surfaces: the profile's "Gear
I own" checklist, the à-la-carte rental checklist at registration, and the
logistics packing totals.

**`gearPrices` decides what the shop rents.** Its keys are the subset of
`gearItems` that appears in the rental checklist, each with its daily price. An
item left out is *owned-only*: a diver can still record that they own one, and
the shop never offers it. That is the whole seam — there is no separate rental
list to keep in sync:

```ts
gearItems:  [..., 'Boots (rubber sole)', 'Boots (felt sole)', ...]
gearPrices: { ..., 'Boots (felt sole)': 50, ... }   // rubber is owned-only
```

The reverse — a price for an item the catalog doesn't list — is rejected by the
config schema, because it fails silently otherwise: the typo'd item is simply
never offered.

Owned-only items are still first-class everywhere else. They count on the
packing board if an older booking names one, they resolve to the same sizing
column, and `RENTAL_GEAR_ITEMS` (not `GEAR_ITEMS`) is what the register forms
render. When some of the catalog is owned-only, the rental checklist says so, so
a diver reads the short list as the whole rack rather than a broken form.

Items are stored **by label**, in `profiles.gear_owned` and in
`bookings.details.gear.items`. Renaming an entry therefore orphans existing
rows: the checklist silently drops the diver's choice and the packing board
leaves the item off. Ship a forward migration that rewrites the old label
alongside the config change — the same applies when an item stops being
rentable, since bookings can still be carrying it. See
`supabase/migrations/20260815000000_split_boots_by_sole.sql` and
`20260817000000_rent_felt_soled_boots_only.sql` for the shape,
including the two things it deliberately leaves alone (`details.charges`, a
frozen receipt of what the diver was charged, and the audit log, a record of
what was written).

**One item, several styles.** An item the shop stocks in more than one style is
listed once per style with the style in trailing parentheses:

```ts
gearItems: [..., 'Boots (rubber sole)', 'Boots (felt sole)', ...]
```

The app reads a shared base name as **one slot on the diver**. Boots are the
case this exists for — felt soles grip algae-covered rock on a shore entry,
rubber is for boats, sand and walking, so a shop needs to know which pair to
pack — but the rule is general (`'Wetsuit (3mm)'` / `'Wetsuit (5mm)'` behaves
the same). What follows from a slot:

- the rental checklist starts with **one** style ticked — the first style the
  shop actually rents — so nobody is defaulted into paying for two pairs of boots;
- ticking one style unticks the others (`toggleGearSelection` in
  `src/lib/gear.ts`), reading alternatives from the whole catalog rather than the
  rental list, so a style carried in from an older booking is cleared even though
  no box is drawn for it any more;
- a diver who owns *any* style of an item rents none of them by default, though
  they can still tick a style they own another of — FunDivers rents felt soles to
  divers who own rubber ones for exactly that reason;
- course-bundled gear packs `FULL_GEAR_SET` — one of every slot — rather than
  the raw catalog;
- but the **profile** checklist has no exclusivity: owning both a felt and a
  rubber pair is a fact, not a conflict. It shows one checkbox per slot —
  "Boots" — with a styles dropdown beside it, so a diver ticks the item and then
  says which styles they own, one or several. Ticking the item records nothing on
  its own: which style they own is the question being asked, and guessing it
  would put the wrong pair on the packing board.

Packing keeps the styles apart — they are separate racks, and a felt pair does
not cover a diver who asked for rubber — while sizing still resolves through
`gearSizeSource`, so both styles are packed by shoe size.

### Feature toggles

`fundive.config.ts` → `features` gates optional surfaces:

- `push` / `broadcast` — refine the push + admin-broadcast features (also gated by
  the VAPID / webhook env).
- `eventSharing` — the in-app "share this event" button. **Optional, off by
  default.** It copies a link to a public event page **on your own website** —
  the app hosts no such page. Turning it on is opt-in and requires web-dev work
  you do yourself:
  1. Build event pages on your site addressed by the **app's event id** (the
     `events` table UUID — the app knows only that, not your own slugs).
  2. Set `urls.eventPage` to a template with an `{id}` placeholder, e.g.
     `https://www.example.com/events/{id}`.
  3. Set `features.eventSharing: true`.

  If the toggle is off or `urls.eventPage` is unset, the button simply doesn't
  render — no fallback, nothing breaks. FunDivers points this at a synced Wix
  event page; that Wix wiring is FunDivers' own, not part of the app.

## Versioning & pulling core updates

Core is released as **semver git tags** (`v1.2.0`) with a `CHANGELOG.md`.

Your fork tracks core as a git remote and merges tags when you want updates:

```sh
git remote add upstream https://github.com/fundive/fundive.git   # once
git fetch upstream --tags
git merge v1.3.0                                                  # or the tag you want
```

Because all your edits live only in the seam files above — which core doesn't
touch — these merges stay conflict-free in normal operation.

**The one thing that can break:** if core changes the config contract, it bumps
`CONFIG_CONTRACT_VERSION` (`src/config/site.ts`). Your `fundive.config.ts`
declares its own `configVersion`; the build **fails loudly** if yours is behind,
printing what to migrate. Follow the CHANGELOG entry for that version, update your
config, bump its `configVersion`, and rebuild. This is the same "bump a version
to force action" mechanism the app already uses for the Terms of Use and waivers.

## Checklist for a new shop

1. Fork the repo; add `upstream` as above.
2. `cp fundive.config.example.ts fundive.config.ts` and fill in every value.
3. Drop your logo/favicon/icons into `public/` at the `assets` paths.
4. Rewrite `src/config/terms.tsx`.
5. Set the two Worker `name`s and the push `[vars]` in the wrangler files.
6. Provision Supabase + Cloudflare and populate secrets ([deployment.md](./deployment.md)).
7. `npm run build` — the build validates your config and fails on anything missing.
8. `make dev` and click through: header/logo, Contact, Terms, payment
   instructions, dashboard currency/timezone all reflect your config.
