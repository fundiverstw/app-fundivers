# Testing

Two Vitest projects live in the same config:

| Project | Environment | Include | Setup |
| --- | --- | --- | --- |
| `unit` | `happy-dom` | `src/**/*.test.{ts,tsx}`, `workers/**/*.test.ts` | `tests/setup.unit.ts` |
| `integration` | `node` | `tests/integration/**/*.test.ts` | `tests/setup.integration.ts` |

Both run via `npx vitest run` (or `make test`).

## Unit & component tests

Pattern: **mock the supabase client, render with `MemoryRouter`, drive
the UI, assert on mock call args**. Nothing hits the network.

Utilities in `tests/test-utils.tsx`:

- `renderWithRouter(ui, { route })` — wraps `MemoryRouter`.
- `byName<T>(name)` — queries a form control by `name=` attribute
  (react-hook-form's `register` sets this; our `<Field>` layout doesn't
  use `<label for>`, so `getByLabelText` doesn't work).
- `mockQueryBuilder<T>(result?)` — returns a chainable stub that looks
  like a `PostgrestBuilder`. Every chainable method (`select`, `eq`,
  `in`, `order`, `insert`, `update`, `upsert`, `delete`, etc.) returns
  the same object; `.single()` / `.maybeSingle()` / awaited `.then()`
  resolves to `{ data, error }`.

### Canonical mock setup

```tsx
const { from, useAuthMock } = vi.hoisted(() => ({
  from:         vi.fn(),
  useAuthMock:  vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))

beforeEach(() => {
  from.mockReset()
  useAuthMock.mockReset()
})

it('does a thing', async () => {
  useAuthMock.mockReturnValue({ user: { id: 'u1' }, profile: { id: 'u1', name: 'Ada' } })
  from.mockReturnValue(mockQueryBuilder({ data: [...] }))
  renderWithRouter(<SomePage />)
  // drive UI, assert
})
```

### When to write a unit test

- Any new React component gets at least a render + primary-interaction
  test (see `*.test.tsx` alongside every page / component).
- Any pure helper (e.g. `src/lib/push-reminders.ts`,
  `src/lib/calendar-layout.ts`) gets a focused `.test.ts` next to it
  with edge cases.
- The push service worker is the exception — it runs in a worker
  context. Covered indirectly via the pure helpers it calls.

## Integration tests

`tests/integration/*.test.ts` run against the **local Supabase stack**
(`make start` first). Each test gets:

- `adminClient()` — `createClient()` with the service-role key
  (bypasses RLS). Use for fixture setup / teardown.
- `anonClient()` — anon key, unauthenticated.
- `userClient(email, password)` — signs in as a real auth user.
- `createTestUser({ role })` — creates a one-off `test_<rand>@example.test`
  account with email pre-confirmed; optionally promotes to admin.
- `createTestDive() / createTestCourse()` — minimal rows in the
  `EO_*` tables so a booking can reference them.
- `deleteTestUser()` / `deleteTestDive()` / `deleteTestCourse()` for cleanup.

**Setup** (`tests/setup.integration.ts`) runs `supabase status -o env`
to populate `API_URL`, `SERVICE_ROLE_KEY`, `ANON_KEY` into
`process.env`. If the local stack isn't running, tests fail fast with
a clear error.

### What integration tests cover

The `tests/integration/` folder is the source of truth — `ls` it for
the full list. Representative slices:

| Pattern | Focus |
| --- | --- |
| `auth-smoke.test.ts` / `profile-trigger.test.ts`           | Signup trigger creates a profile; login returns a session; `handle_new_user` edge cases |
| `constraints.test.ts` / `core-rls.test.ts`                 | Booking XOR / unique / immutability triggers / core RLS |
| `staff-role.test.ts`                                       | The staff role's read scope and write denial |
| `eo-*-admin-writes.test.ts` / `eo-public-read.test.ts`     | RLS on the EO_\* catalog tables (admin can write, anon/diver read what's public) |
| `eo-events-*.test.ts`                                      | Event-level constraints (cancellation, payment deadlines) |
| `event-addons.test.ts` / `event-rooms.test.ts`             | Junction tables (`eo_dive_addons`, `eo_dive_rooms`) |
| `memos.test.ts`                                            | `event_memos` XOR + resolved-trio CHECK |
| `duties.test.ts`                                           | Duty assignee trigger (must be staff or admin) |
| `dive-sites-rls.test.ts` / `cert-levels-rls.test.ts`       | Reference data: read-open, write-admin |
| `admin-audit-log.test.ts`                                  | Admin mutations land in the audit log |
| `pii-retention.test.ts`                                    | TOS-acceptance + retention behaviours |
| `seed-integrity.test.ts`                                   | `supabase/seed.sql` still loads cleanly |
| `cert-cards-storage.test.ts`                               | Storage bucket policies for cert-card uploads |
| `profile-gear-sizes-rpc.test.ts`                           | RPC for atomic gear-size update |

### When to write an integration test

- Adding a new CHECK or unique constraint → integration test it.
- Adding a new RLS policy → integration test asserts both the "allowed"
  and "denied" paths (use `userClient` + `anonClient`).
- Adding a trigger → exercise the side effects.
- Any pure-logic piece is covered by unit tests, not integration.

**Don't mock the database in integration tests.** The whole point is
catching mock-vs-prod drift; an earlier incident where mocked tests
passed but a real migration broke is why we bothered to wire the live
stack in the first place.

## Running tests

```sh
make test                       # unit + integration (stack must be up)
npx vitest run                  # same, without the guard
npx vitest run src/lib          # just a folder
npx vitest                      # watch mode (unit only by default)
```

## Coverage

`@vitest/coverage-v8` is installed. Run coverage with:

```sh
npx vitest run --coverage
```

There's no enforced threshold; keep the "write a test for new code"
habit and coverage stays reasonable.
