# FunDive

**FunDive** is a free, open-source, self-hostable platform for running a dive
center — bookings, courses, payments, dive logs, fleet ride logistics, trusted-
partner referrals, and staff operations. It's packaged to be **forked**: point
the config at your shop and deploy your own instance. *FunDivers TW* is the shop
it was built for and its first deployment.

- **Stack:** React 19 + Vite + Tailwind, Supabase (Postgres + PostgREST + Deno
  edge functions), Cloudflare Workers (SPA + a push-notification cron worker).
- **License:** [AGPL-3.0-or-later](LICENSE) — if you run a modified FunDive as a
  hosted service, you must publish your modifications.

## Quick start

```sh
make start     # boot the local Supabase stack (Docker)
make dev       # Vite dev server against the local stack
make test      # full test suite (unit + integration)
```

You'll need a `fundive.config.ts` and a `.env.local`. To stand up a fresh
instance:

```sh
cp fundive.config.example.ts fundive.config.ts   # then edit for your shop
```

See **[docs/forking.md](docs/forking.md)** for the full fork walkthrough
(config fields, env vars, Supabase + Cloudflare setup) and
**[docs/deployment.md](docs/deployment.md)** for the deploy commands and their
required environment variables.

## Configuration

All shop-specific values — name, contact, URLs, timezone, currency, theme
colors, asset paths, gear list, prices, and feature toggles — live in the root
`fundive.config.ts` (pure data), read through the typed handle in
`src/config/site.ts` and validated by `src/config/site.schema.ts`. Nothing
shop-specific is hardcoded in the app. Bumping the config contract is recorded
in [CHANGELOG.md](CHANGELOG.md).

## Documentation

Start at **[docs/README.md](docs/README.md)** — an index into focused per-topic
docs (architecture, data model, auth, bookings, payments, admin, push
notifications, testing, deployment, forking). Contributors should read it before
changing code; `CLAUDE.md` captures the load-bearing conventions.

## Compared to competitors

FunDive is a free, open-source, self-hostable platform for running a dive
center. Every commercial alternative below is paid, closed-source SaaS; each is
scored against FunDive on the capabilities that most separate them.

Legend: ✓ yes · ~ partial/limited · ✗ no · ? not documented

| Platform | Open source | Online card pay | POS / rental inventory | E-sign waiver | Fleet ride logistics | Family lead-payer | Price / mo |
| --- | :--: | :--: | :--: | :--: | :--: | :--: | --- |
| **FunDive (this app)** | **✓** | ✗ (manual) | ✗ | ✓ | **✓** | **✓** | **free** (self-host) |
| DiveAdmin | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | $39–119 |
| DiveShop360 | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | $149+ (upper tiers gated) |
| Lueira | ✗ | ✓ | ✓ | ✓ (eIDAS) | ✗ | ~ (family links) | €80–212 |
| Bloowatch | ✗ | ✓ (0% comm.) | ✓ | ✓ | ✗ | ✗ | €49–119 |
| AquaDivePro | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | €25–55 |
| DivePrep | ✗ | ✓ | ~ (gear inv.) | ✓ | ✗ | ✗ | free (beta, hosted) |
| DiversDesk | ✗ | ✓ | ? | ✓ | ✗ | ✗ | $27–64 |
| DiveOps | ✗ | ✓ | ~ (equipment) | ✓ | ✗ | ✗ | not public |
| ScubaOcity | ✗ | ✓ | ✓ (POS sync) | ✓ | ✗ | ~ (group leader) | not public |
| DivingCenterSoftware | ✗ | ~ | ✓ (inventory) | ✗ | ✗ | ✗ | not public |
| GeekDivers | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | variable (≈2 fun dives) |
| DiveCrewPro | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | $49 flat (scheduling only) |

**Read:** FunDive is the only free, open-source, self-hostable option — you own
the code and the data, with no per-seat fee. It's also alone in offering
car-ride/seat logistics and family lead-payer billing. The paid field still
leads on online card payments and POS / rental inventory, where FunDive trails.
