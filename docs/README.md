# FunDivers TW — docs

Start here when picking up this codebase. Each doc below covers one
slice; read the one closest to the change you're making before you dive
into source.

| Doc | What it covers |
| --- | --- |
| [architecture.md](./architecture.md)                   | Stack, directory layout, runtime boundaries (client / worker / Supabase) |
| [data-model.md](./data-model.md)                       | Every table, the `EO_*` Bubble-import convention, XOR FK pattern |
| [authentication.md](./authentication.md)               | Sign-up trigger, `useAuth`, role gating, `ProtectedRoute` / `AdminRoute` |
| [events-and-bookings.md](./events-and-bookings.md)     | Calendar rendering, register-form wizard, `bookings.details` JSONB shape |
| [payments.md](./payments.md)                           | Deposit vs balance semantics, payments ledger, refund flow |
| [admin.md](./admin.md)                                 | Admin routes, event memos, user search, role-view toggle |
| [trip-board.md](./trip-board.md)                       | Partner referral network: curated trips abroad, referral codes, kickback ledger |
| [push-notifications.md](./push-notifications.md)       | Web Push: VAPID, service worker, Cloudflare cron sender, `/admin-broadcast`, `/notify-duty`, CORS |
| [testing.md](./testing.md)                             | Unit vs integration conventions, `mockQueryBuilder`, Makefile surface |
| [deployment.md](./deployment.md)                       | Env vars (which secret lives where), Cloudflare deploy (CLI + GitHub Actions), Supabase link / push / pull / verify, edge functions |
| [forking.md](./forking.md)                             | Running your own shop: the `fundive.config.ts` seam, brand assets, feature gates, and how to pull core updates without conflicts |
| [security-audit.md](./security-audit.md)               | Point-in-time audit (2026-06-02): findings by severity, fix priority |
| [legal-brief.md](./legal-brief.md)                     | Brief for the Terms-of-Use / Privacy lawyer review: data inventory, flows, code-text alignment, open questions |

## Conventions called out across docs

- **Migrations are immutable once pushed.** Add a forward migration; never
  edit a file already applied to cloud. See
  [data-model.md](./data-model.md#migrations).
- **No i18n.** The app is English-only.
- **No emojis in code or commits** unless explicitly requested.
- **XOR FKs** appear in `bookings` and `event_memos`: exactly one of
  `eo_dive_id` / `eo_course_id` is set. Don't "fix" one side.

## Common commands

```sh
make dev       # Vite against local supabase stack
make start     # boot local supabase stack (Docker)
make test      # full test suite (unit + integration)
make push      # push local migrations to cloud
make verify    # confirm local schema + row counts match cloud
make deploy    # deploy both workers (SPA + push cron)
```
