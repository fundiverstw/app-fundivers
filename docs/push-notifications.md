# Push Notifications

Divers get browser push reminders from the PWA:

| Trigger            | Windows (days before event)          |
| ------------------ | ------------------------------------ |
| Event reminder     | 7, 1                                 |
| Payment reminder   | 21, 14, 7, 3, 1 (while amount owed)  |

A single daily Cloudflare Worker cron picks every booking that lands in a
window today, chooses the right reminder kind, and sends via Web Push.
The `push_notifications_sent` table makes the cron idempotent — rerunning
never double-notifies.

## Pieces

```
supabase/migrations/20260422180000_push_notifications.sql   tables + RLS
src/sw.ts                                                   service worker (push + notificationclick)
src/lib/push.ts                                             client subscribe/unsubscribe
src/lib/push-reminders.ts                                   pure selection logic (shared with worker)
src/pages/ProfilePage.tsx → NotificationsToggle             opt-in UI
workers/push/                                               Cloudflare Worker cron sender
```

## One-time setup

### 1. Generate VAPID keys

```sh
npx web-push generate-vapid-keys
```

You get a public + private key. The **public** key ships with the client
(`VITE_VAPID_PUBLIC_KEY`); the **private** key stays in the worker
(`VAPID_PRIVATE_KEY`).

### 2. Apply the migration

```sh
npm run db:push
```

### 3. Configure the client env

Add to `.env.local`:

```sh
VITE_VAPID_PUBLIC_KEY=<public-key-from-step-1>
```

Rebuild and deploy the frontend as usual (`npm run deploy`).

### 4. Configure the worker

```sh
cd workers/push
npm install

# Secrets (production):
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put ADMIN_TRIGGER_SECRET   # for /run manual trigger

# VAPID_SUBJECT is set in wrangler.toml [vars]; edit to a real mailto.
```

For local development create `workers/push/.dev.vars` from
`.dev.vars.example` and run:

```sh
npm run dev           # starts wrangler dev --test-scheduled
# then in another terminal:
curl "http://localhost:8787/__scheduled?cron=0+2+*+*+*"
```

### 5. Deploy the worker

```sh
make deploy-push        # or: make deploy (to ship both workers together)
```

The cron fires at `0 2 * * *` UTC (= 10:00 Asia/Taipei) — edit
`wrangler.toml` if you want a different hour.

## Manual trigger (rollout / debugging)

Once deployed, you can run the cron on demand:

```sh
curl -H "Authorization: Bearer $ADMIN_TRIGGER_SECRET" \
     https://fundivers-push.<your-subdomain>.workers.dev/run
# → {"sent":3,"skipped":0}
```

## Admin one-off broadcast

The `/admin-broadcast` endpoint sends an immediate push (custom title +
body) to **every** opted-in device. Surfaced in-app at
`/admin/notifications` (Manage → "One-off notification") for admins; the
worker also gates by reading `profiles.role` via the caller's JWT.

```
POST /admin-broadcast
Authorization: Bearer <admin user's session JWT>
{ "title": "Trip cancelled", "body": "Typhoon — see calendar.", "url": "/" }
→ { "sent": N, "skipped": M, "webhook": true | false | null }
```

Set `SUPABASE_ANON_KEY` (worker secret) so the admin gate can run.
Use the **legacy JWT-format anon key** (the `eyJ…` value of
`VITE_SUPABASE_ANON_KEY`) — Supabase's auth API rejects the
publishable-format `sb_publishable_…` keys here as "Invalid API key."
Set `BROADCAST_WEBHOOK_URL` if you also want the same `{title, body}`
payload relayed to a webhook (LINE Messaging API relay, n8n /
Make.com flow, etc.) — leaving it unset just skips the relay and
`webhook` returns `null` in the response.

```sh
cd workers/push
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put BROADCAST_WEBHOOK_URL   # optional
```

## Duty-assigned push (`/notify-duty`)

When an admin assigns a duty (`/admin/duty`), the SPA fires a
fire-and-forget POST so the assignee's device beeps immediately
rather than waiting for the next daily cron tick.

```
POST /notify-duty
Authorization: Bearer <admin user's session JWT>
{ "duty_id": "<uuid>" }
→ { sent: N, skipped: M }
```

The worker re-reads the duty under the caller's JWT (RLS gates on
admin), then uses the service-role key to look up the assignee's
push subscriptions and send. Errors are deliberately swallowed on
the SPA side — the duty row is the source of truth, the push is
just acceleration. See `src/lib/duties.ts → notifyDutyAssigned`.

## CORS

The worker is on a different origin from the SPA, so browser POSTs
to `/admin-broadcast` and `/notify-duty` trigger a preflight. The
worker allowlists exactly `https://app.fundiverstw.com` and
`http://localhost:5173`; other origins get no
`Access-Control-Allow-Origin` and the browser blocks them. CORS is
browser-side only — auth is still enforced per-handler via the
Bearer JWT, so the allowlist is for UX, not security.

## iOS caveat

On iPhone/iPad, Web Push only works when the PWA is **installed to the
Home Screen** (Share → Add to Home Screen, then open from there). The
`NotificationsToggle` section of the Profile page detects this and shows
the install hint instead of the toggle.

Android, desktop Chrome/Edge/Firefox, and macOS Safari 16+ all support
push in the regular browser without install.

## Operational notes

- The worker cleans up subscriptions that return HTTP 404/410 — dead
  endpoints are deleted on the next cron run.
- `push_notifications_sent` keeps a permanent record per
  `(user, event, kind)`. If you ever need to **re-send** a specific
  reminder, delete the matching row and wait for the next cron tick.
- Toggling off in the Profile page deletes the DB row and calls
  `PushSubscription.unsubscribe()` — the browser releases the endpoint.
- Adding or removing a reminder window means editing
  `src/lib/push-reminders.ts` (both the constants and
  `eventKindForDays` / `paymentKindForDays`) **and** the `kind` CHECK
  constraint on `push_notifications_sent`. Always add a forward
  migration, never edit the existing one.
