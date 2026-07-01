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
| `fundive.config.ts` | Shop name, contact details, URLs, locale (timezone/currency), theme colors, asset paths, feature toggles, gear list/prices. Copy `fundive.config.example.ts` to start. |
| `src/config/terms.tsx` | Your Terms of Use / privacy text (`TermsContent`). |
| `public/…` (the paths in `assets`) | Your logo, favicon, PWA icons, broadcast glyph. |
| `.env.local` / `.env.production` / GitHub Actions secrets | Supabase URL + keys, Turnstile keys, VAPID keys — see [deployment.md](./deployment.md). |
| `wrangler.toml` + `workers/push/wrangler.toml` | The two Worker `name`s (globally unique on Cloudflare), and the push worker's `[vars]` (`VAPID_SUBJECT`, `ALLOWED_ORIGINS`). |

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

### Feature toggles

`fundive.config.ts` → `features` gates optional surfaces:

- `map` — the dive-site Map tab. It currently ships Taiwan-specific geometry, so
  leave it `false` unless you're the Taiwan shop.
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
