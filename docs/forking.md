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
| `fundive.config.ts` | Shop name, contact details, URLs, locale (timezone/currency), PWA manifest colors, asset paths, feature toggles, gear list/prices, calendar trip keywords, weather-baseline region. Copy `fundive.config.example.ts` to start. |
| `src/index.css` (`@theme` block) | Your **brand colors** — see [Colors](#colors) below. |
| `src/config/terms.tsx` | Your Terms of Use / privacy text (`TermsContent`). |
| `public/…` (the paths in `assets`) | Your logo, favicon, PWA icons, broadcast glyph. |
| `.env.local` / `.env.production` / GitHub Actions secrets | Supabase URL + keys, Turnstile keys, VAPID keys — see [deployment.md](./deployment.md). |
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

### Feature toggles

`fundive.config.ts` → `features` gates optional surfaces:

- `radio` — the external radio links in the app shells.
- `push` / `broadcast` — refine the push + admin-broadcast features (also gated by
  the VAPID / webhook env).

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
