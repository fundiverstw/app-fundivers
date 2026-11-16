# FunDivers TW

FunDivers TW's app at [app.fundiverstw.com](https://app.fundiverstw.com):
dive registration, logbook and shop admin. It runs
[FunDive](https://github.com/fundive/fundive), the open-source platform, so
this repository holds only what makes it FunDivers':

| Path | What |
| --- | --- |
| `fundive.config.ts` | shop identity, URLs, locale, dark design, gear and prices, boat manifest |
| `public/` | logo, icons, favicon and the event photos, laid over the platform's |
| `wrangler.toml`, `workers/push/wrangler.toml` | the production worker names, domain, vars and crons |
| `docs/` | shop documents: the cutover runbook, legal brief, security audits, paper registration form, survey poster |
| `scripts/backup-prod.sh` | logical backup of the production database |

The platform is pinned to a fundive commit or tag in `package.json`. Code changes go to
`fundive`; a fix reaches this shop by bumping that pin.

```sh
make install         # the pinned platform
make dev             # against a local Supabase stack (run it from a fundive clone)
make deploy          # SPA + push worker + edge functions
make push            # the platform's new migrations
make help            # everything else
```

Env files: see `.env.example`. Moving from the old self-contained app:
see [docs/cutover.md](docs/cutover.md).
