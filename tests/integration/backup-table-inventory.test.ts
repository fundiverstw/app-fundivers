import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { basename } from 'node:path'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser, type TestUser,
} from './helpers'

// backup_table_inventory() is what the admin database backup enumerates, so
// what it reports IS the coverage of the backup. A table it misses is a table
// that silently stops being backed up.

const admin = adminClient()
let diver: TestUser

beforeAll(async () => { diver = await createTestUser(admin, { role: 'diver' }) })
afterAll(async () => { await deleteTestUser(admin, diver.id) })

interface InventoryRow {
  table_name:  string
  columns:     string[]
  key_columns: string[]
}

async function inventory(): Promise<InventoryRow[]> {
  const { data, error } = await admin.rpc('backup_table_inventory' as never)
  expect(error).toBeNull()
  return (data ?? []) as unknown as InventoryRow[]
}

describe('backup_table_inventory', () => {
  it('names every table the shop keeps its records in', async () => {
    const names = (await inventory()).map(r => r.table_name)
    // A spread across the schema — bookings and money, people, the catalog,
    // the paperwork. Not the full list: this asserts the function reaches the
    // whole schema, and the next test pins that it misses nothing.
    for (const table of [
      'bookings', 'events', 'payments', 'credits', 'profiles',
      'waivers', 'waiver_signatures', 'prices', 'duties', 'dive_logs',
    ]) {
      expect(names).toContain(table)
    }
  })

  it('matches the database, table for table', async () => {
    const reported = (await inventory()).map(r => r.table_name).sort()
    // Asked of PostgreSQL directly, out through psql rather than through the
    // function under test. Drift between the two is the bug this exists for:
    // a table added tomorrow appears in both or the backup quietly skips it.
    const container = `supabase_db_${basename(process.cwd())}`
    const actual = execSync(
      `docker exec -i ${container} psql -U postgres -d postgres -tAc ` +
      `"select tablename from pg_tables where schemaname = 'public' order by tablename"`,
      { encoding: 'utf-8' },
    ).trim().split('\n').map(s => s.trim()).filter(Boolean)

    expect(reported).toEqual(actual)
    expect(actual.length).toBeGreaterThan(20)
  })

  it('reports each table with its columns and the key to page it by', async () => {
    const rows = await inventory()
    const bookings = rows.find(r => r.table_name === 'bookings')!
    expect(bookings.columns).toEqual(expect.arrayContaining(['id', 'user_id', 'event_id', 'status', 'details']))
    expect(bookings.key_columns).toEqual(['id'])

    // Every table can be paged deterministically, or the backup could repeat
    // or skip rows in a table over 1000 rows long.
    for (const row of rows) {
      expect(row.columns.length).toBeGreaterThan(0)
      expect(row.key_columns.length).toBeGreaterThan(0)
    }
  })

  it('is service-role only — no browser client can map the schema with it', async () => {
    const { error: anonErr } = await anonClient().rpc('backup_table_inventory' as never)
    expect(anonErr).not.toBeNull()

    const asDiver = await userClient(diver.email, diver.password)
    const { error: diverErr } = await asDiver.rpc('backup_table_inventory' as never)
    expect(diverErr).not.toBeNull()
  })
})
