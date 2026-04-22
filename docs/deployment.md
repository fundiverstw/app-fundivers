# Deployment

Two things get deployed:

1. **The SPA** — Cloudflare Worker hosting the built `dist/` assets.
2. **The push cron** — separate Cloudflare Worker in `workers/push/`
   running the daily reminder job. See
   [push-notifications.md](./push-notifications.md) for that one.

Database changes deploy via `supabase db push` — a separate workflow
described below.

## Environment variables

### Frontend build (`.env.local`, read by Vite)

| Var | Where used | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL`            | `src/lib/supabase.ts` | Cloud project URL; local is `http://127.0.0.1:64321` |
| `VITE_SUPABASE_ANON_KEY`       | `src/lib/supabase.ts` | Public; ships to the browser |
| `VITE_VAPID_PUBLIC_KEY`        | `src/lib/push.ts`     | Optional — push toggle is hidden if unset |

### Supabase CLI (`.env.local`, read by `make` targets)

| Var | Notes |
| --- | --- |
| `SUPABASE_PROJECT_REF`   | e.g. `abcdefghij` — used by `make link` and `make push` |
| `SUPABASE_DB_PASSWORD`   | DB password for migrations |
| `SUPABASE_POOLER_HOST`   | e.g. `aws-0-ap-east-1.pooler.supabase.com` — used by `make verify` |

### Push worker (Cloudflare secrets, not env files)

See [push-notifications.md § Configure the worker](./push-notifications.md#4-configure-the-worker).

## Frontend deploy

`npm run deploy` expands to:

```sh
npm run build                                       # tsc -b && vite build
dotenv -e .env.local -- wrangler deploy             # pushes dist/ to the Worker
```

`wrangler.toml` at the repo root is minimal:

```toml
name = "app-fundiverstw"
compatibility_date = "2025-04-16"
[assets]
directory = "./dist"
```

No custom fetch handler — it's a pure static-asset Worker. On first
deploy you may need `wrangler login` to authenticate.

## Supabase schema workflow

Migrations are **forward-only**. Flow for a schema change:

```sh
# 1. Write a new migration file under supabase/migrations/
#    Name format: YYYYMMDDHHMMSS_<slug>.sql

# 2. Apply locally and test
make reset              # or `make diff` to preview drift, then `make reset`
make test               # integration suite exercises the new schema

# 3. Push to cloud
make push               # applies to the linked project

# 4. Verify the cloud matches
make verify             # schema migration list + row-count parity check
```

`scripts/verify-sync.sh` does a two-step check:

1. `supabase migration list --linked` — confirms local + cloud agree on
   applied migrations.
2. Row-count parity per table across `public` + `auth` schemas — catches
   missing or extra data rows.

### Linking a fresh checkout

```sh
make link     # runs `supabase link --project-ref "$SUPABASE_PROJECT_REF"`
make pull     # generates a baseline migration from cloud (one-time if cloud drifted)
```

### Pulling data down for local dev

```sh
make dump-data    # writes cloud data into supabase/seed.sql
make reset        # rebuilds local from migrations + seed
```

## Release checklist

Small feature or bug fix:

1. Run `make test` locally — unit + integration.
2. If the change touches the schema: `make reset` first, then
   `make test`, then `make push` after review.
3. `make deploy` for the frontend.
4. If push notifications are affected: `cd workers/push && npm run deploy`.
5. `make verify` — confirm cloud schema + row counts match local
   expectations post-deploy.

## Rollback

- **Frontend:** `wrangler deployments list` shows history;
  `wrangler rollback <deployment-id>` reverts the SPA.
- **Push worker:** same flow inside `workers/push/`.
- **DB:** there is no automatic down-migration — write a **forward**
  migration that undoes the change, then `make push`. Do not edit or
  delete an applied migration file. Recovery from truly bad migrations
  is a restore from Supabase's point-in-time backup (dashboard →
  Database → Backups).
