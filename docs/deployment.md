# Deployment

Three things get deployed:

1. **The SPA** — Cloudflare Worker hosting the built `dist/` assets.
2. **The push cron** — separate Cloudflare Worker in `workers/push/`
   running the daily reminder job. See
   [push-notifications.md](./push-notifications.md) for that one.
3. **Supabase Edge Functions** under `supabase/functions/` — on-demand
   server code (PDF emailer, etc.), deployed via `supabase functions
   deploy`.

Database changes deploy via the Supabase CLI (`make push`) — the
**Supabase schema workflow** section below. Migrations are pushed from a
developer's machine only; there is no CI/GitHub Actions migration job.

## Environment variables

Secrets live in five distinct places. Putting one in the wrong place is
the most common deploy footgun, so the table below maps each value to
its destination(s).

| Value | Local dev (`.env.local`) | Local build + deploy (`.env.production`) | Push worker stash (`.env.push`) | Cloudflare Worker secret (`wrangler secret put`) |
| --- | :-: | :-: | :-: | :-: |
| `VITE_SUPABASE_URL`         | yes | yes |     |     |
| `VITE_SUPABASE_ANON_KEY`    | yes | yes |     |     |
| `VITE_TURNSTILE_SITE_KEY`   | yes | yes |     |     |
| `VITE_VAPID_PUBLIC_KEY`     | yes | yes |     |     |
| `VITE_PUSH_WORKER_URL`      | yes | yes |     |     |
| `SUPABASE_PROJECT_REF`      | yes |     |     |     |
| `SUPABASE_DB_PASSWORD`      | yes |     |     |     |
| `SUPABASE_POOLER_HOST`      | yes |     |     |     |
| `VAPID_PUBLIC_KEY` *(push worker — same value as `VITE_VAPID_PUBLIC_KEY`, just a different name)*  |     |     | yes | yes (push worker) |
| `VAPID_PRIVATE_KEY`         |     |     | yes | yes (push worker) |
| `VAPID_SUBJECT`             |     |     | yes | set in `workers/push/wrangler.toml [vars]` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` *(push worker)* |     |     |     | yes (push worker) |
| `ADMIN_TRIGGER_SECRET` / `BROADCAST_WEBHOOK_URL` |     |     |     | yes (push worker) |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` |     |     |     | `supabase secrets set` (edge function) |
| `CLOUDFLARE_API_TOKEN`      |     | yes |     |     |
| `CLOUDFLARE_ACCOUNT_ID`     |     | yes |     |     |

### `.env.local` — local dev

Read by Vite (`npm run dev`) and by `make` targets that talk to the
linked Supabase project.

| Var | Where used | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL`      | `src/lib/supabase.ts` | Cloud project URL; local is `http://127.0.0.1:64321` |
| `VITE_SUPABASE_ANON_KEY` | `src/lib/supabase.ts` | Public; ships to the browser |
| `VITE_TURNSTILE_SITE_KEY`| `src/components/register/TurnstileWidget.tsx` | **REQUIRED** — the prod build fails if unset (guest-registration captcha) |
| `VITE_VAPID_PUBLIC_KEY`  | `src/lib/push.ts`     | Push toggle is hidden if unset |
| `VITE_PUSH_WORKER_URL`   | `src/pages/admin/*`, `src/lib/{duties,reschedule,event-cancellation}.ts` | Push worker origin for admin push actions; degrades off if unset |
| `SUPABASE_PROJECT_REF`   | `make link`, `make push`     | e.g. `abcdefghij` |
| `SUPABASE_DB_PASSWORD`   | `make push`, `make pull`     | DB password for migrations |
| `SUPABASE_POOLER_HOST`   | `make verify` (`scripts/verify-sync.sh`) | e.g. `aws-0-ap-east-1.pooler.supabase.com` |

### `.env.production` — local `make deploy` build + deploy creds

Vite auto-loads this file when `vite build` runs in production mode.
The same `VITE_*` values from `.env.local` go here so a hand-run
`make deploy` produces a bundle that points at the cloud Supabase
project. It also holds the Cloudflare deploy creds
(`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`) that `make deploy-app`
/ `make deploy-push` use to authenticate `wrangler` non-interactively —
so a local deploy needs no `wrangler login`. Not used by the GitHub
Actions deploy (Actions sources its values from repo secrets instead).

### `.env.push` — push worker secret stash

A personal scratchpad — nothing reads it. It exists so that when you
run `wrangler secret put` for the push worker you have the values to
paste. The actual secrets live on Cloudflare. Note that
`VAPID_PUBLIC_KEY` here is the **same value** as `VITE_VAPID_PUBLIC_KEY`
in `.env.local` / `.env.production`; the worker just doesn't use the
`VITE_` prefix because it isn't a Vite project.

### Cloudflare Worker secrets

Set via `wrangler secret put` from inside the worker's directory; they
never appear in env files at deploy time. See
[push-notifications.md § Configure the worker](./push-notifications.md#4-configure-the-worker)
for the push worker's full list. The SPA Worker (`app-fundiverstw`)
has no Worker-level secrets — all of its config is baked into the
bundle at build time via `VITE_*`.

### Supabase Edge Function secrets

Set via `supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" …`.
Currently only `create-registration` uses these (`GMAIL_USER`,
`GMAIL_APP_PASSWORD`). See [§ Supabase Edge Functions](#supabase-edge-functions).

Do **not** put `VAPID_PRIVATE_KEY`, service-role keys, or any push
worker secret in GitHub. Those stay on Cloudflare via `wrangler secret
put`; the workflow only deploys code, it doesn't rotate worker secrets.

## Workers

Two Cloudflare Workers are deployed separately:

| Worker | Config | Make target |
| --- | --- | --- |
| `app-fundiverstw`  | `./wrangler.toml`              | `make deploy-app` |
| `fundivers-push`   | `./workers/push/wrangler.toml` | `make deploy-push` |

`make deploy` runs both in sequence. Deploys are local-only (driven by
`.env.production`); there is no GitHub Actions deploy.

### `app-fundiverstw` (SPA)

`make deploy-app` first checks the Cloudflare creds are present, then:

```sh
npm run build                                       # tsc -b && vite build (cloud VITE_* from .env.production)
. ./.env.production && npx wrangler deploy           # CLOUDFLARE_API_TOKEN/ACCOUNT_ID authenticate wrangler
```

`wrangler.toml` at the repo root is minimal:

```toml
name = "app-fundiverstw"
compatibility_date = "2025-04-16"
[assets]
directory = "./dist"
```

No custom fetch handler — it's a pure static-asset Worker. Auth is the
`CLOUDFLARE_API_TOKEN` from `.env.production` — no `wrangler login` needed.

### `fundivers-push` (cron sender)

`make deploy-push` runs `wrangler deploy` from `workers/push/`, sourcing
the same `.env.production` creds so it authenticates non-interactively.
The target installs deps on first run. The worker's own runtime secrets
are set separately via `wrangler secret put` — see
[push-notifications.md § Configure the worker](./push-notifications.md#4-configure-the-worker).

## Supabase Edge Functions

Each directory under `supabase/functions/` is one deployable function
(Deno 2 runtime). Shared code lives under `supabase/functions/_shared/`
and is imported relatively. `make deploy-functions` runs `supabase
functions deploy` (no name → ships every function in the directory)
against the linked project.

### `create-registration`

Single atomic endpoint behind the registration form (`RegisterFormBody`).
Either the body has `email` + `password` (guest flow → creates the
account with `email_confirm: true`, bypassing the click-to-confirm
gate) or the caller's Bearer JWT identifies an authed user. Either
way, the function then UPDATEs the profile, INSERTs the booking,
builds a PDF (via `_shared/pdf.ts`, layout ported from the Wix
backend), and emails it via Gmail SMTP to both `fundiverstw@gmail.com`
and the diver. Returns `{ booking_id, session }`; `session` is
populated only on the guest path so the client can `setSession`
immediately. If the booking insert fails on the guest path the
just-created auth user is deleted to keep retries clean.

Required secrets (`supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" …`):

| Secret | What it is |
| --- | --- |
| `GMAIL_USER`          | Gmail account that sends the mail |
| `GMAIL_APP_PASSWORD`  | Gmail [app password](https://support.google.com/accounts/answer/185833) — not the normal password |

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` are
auto-injected by the edge runtime.

Deploy:

```sh
make deploy-functions      # ships every function under supabase/functions/
supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" \
  GMAIL_USER=fundiverstw@gmail.com \
  GMAIL_APP_PASSWORD=<app-password>
```

Local testing:

```sh
supabase functions serve create-registration --env-file .env.local
# ...then in another shell, curl with a registration body.
```

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
3. `make deploy` — ships both workers (SPA + push cron). Use
   `make deploy-app` or `make deploy-push` if you're touching only one.
4. `make verify` — confirm cloud schema + row counts match local
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
