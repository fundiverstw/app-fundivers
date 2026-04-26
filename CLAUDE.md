# FunDivers TW — orientation for Claude

**Read `docs/README.md` before you start changing code.** It's an index
into focused per-topic docs (architecture, data model, auth, bookings,
payments, admin, push notifications, testing, deployment). Follow the
link that matches the change you're making; those docs explain
conventions and non-obvious mechanics the code doesn't spell out.

## Load-bearing rules

1. **Migrations are immutable once pushed.** Every file in
   `supabase/migrations/` that has been `make push`'d is locked — the
   Supabase migration registry enforces checksums. To change a table,
   write a **new** forward migration. Never edit an old one.

2. **English only.** The app has no i18n scaffolding and none is
   planned. Don't add translation layers.

3. **Don't mock the database in integration tests** under
   `tests/integration/`. Those run against the live local Supabase
   stack on purpose — the whole point is catching mock/prod drift.
   Unit tests *do* mock Supabase, via `mockQueryBuilder` in
   `tests/test-utils.tsx` — follow that pattern, don't invent a new one.

4. **No emojis in code or commits** unless the user explicitly asks.

5. **XOR foreign keys.** `bookings` and `event_memos` each reference
   exactly one of `eo_dive_id` / `eo_course_id`. The DB enforces it
   via CHECK constraint. Don't "normalize" one side away.

6. **`EO_*` tables are Bubble-imported legacy catalog data.** Text
   `_id`, text date/time columns, CSV / JSON-string foreign-key lists.
   See `docs/data-model.md` before reading them directly — most
   reads should go through `src/lib/events.ts`.

7. **Write tests for new code.** Components get a render +
   interaction test. Pure helpers get a `.test.ts` alongside the
   source. Constraints / triggers / RLS policies get integration
   tests. See `docs/testing.md`.

8. **Commit messages stay on one line.** A single concise subject —
   no body, no bullet list, no expanded prose. The diff is the detail.

9. **No Claude attribution in commits or PRs.** Don't append
   `Co-Authored-By: Claude` trailers, don't sign commits as Claude,
   and don't mention "Generated with Claude Code" in commit messages
   or PR bodies.

## Verifying from memory

If a memory or prior conversation claims a file, function, or flag
exists, **verify it still does** before acting on the claim:

- Named file path → `ls` / Read it.
- Named function or SQL object → `grep` / query.

Memories are snapshots in time, not live truth.

## Commands you'll actually run

```sh
make dev       # Vite against local supabase stack
make start     # boot local supabase stack (Docker)
make test      # full test suite (unit + integration)
make push      # push local migrations to cloud
make verify    # confirm local schema + row counts match cloud
make deploy    # deploy both workers (SPA + push cron)
```

See `docs/deployment.md` for env vars these commands expect in
`.env.local`.
