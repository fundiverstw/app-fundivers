# FunDivers TW

FunDivers TW's app at [app.fundiverstw.com](https://app.fundiverstw.com) runs on [FunDive](https://github.com/fundive/fundive). This
repository holds only what makes it ours:

| Path | What |
| --- | --- |
| `fundive.config.ts` | shop name, URLs, locale, design, gear and prices |
| `public/` | our logo, icons and photos, laid over the platform's |
| `wrangler.toml`, `workers/push/wrangler.toml` | our Cloudflare worker names, domain and push settings |
| `.github/workflows/` | manual Deploy and Push-migrations buttons |
| `package.json` | the FunDive version we run |
| `docs/` | shop documents: legal brief, security audits, paper registration form, survey poster, and the move from the old self-contained app (`docs/cutover.md`) |

Setup, deploys and upgrades: https://fundive.github.io/fundive/self-hosting
