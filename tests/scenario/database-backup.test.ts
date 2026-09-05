import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { world, ledger, teardownWorld, type World, type Ledger } from './world'
import type { TestUser } from '../integration/helpers'
import { handleDatabaseBackup, type Deps } from '../../supabase/functions/export-database-backup/handler'

// The admin database backup, run against the real schema.
//
// The handler's own suite drives it with a hand-built query builder, which
// proves the logic and nothing about PostgREST: whether `.order().range()`
// actually pages, whether service_role may read every table the inventory
// names, whether the role check reads a real profile. That is the seam this
// closes. Only the ZIP writer is stubbed — it records what it was given, which
// is more useful here than a zipped byte array.

let w: World
const l: Ledger = ledger()
let admin: TestUser

beforeAll(async () => {
  w = await world(l)
  admin = w.adminUser
})
afterAll(async () => { await teardownWorld(l) })

function backupDeps(files: Record<string, string>): Deps {
  const url = process.env.API_URL!
  const anonKey = process.env.ANON_KEY!
  const service = createClient(url, process.env.SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  return {
    admin: service as unknown as Deps['admin'],
    makeAuthedClient: (token: string) => createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth:   { persistSession: false },
    }) as unknown as ReturnType<Deps['makeAuthedClient']>,
    zip: (given) => {
      const decoder = new TextDecoder()
      for (const [name, bytes] of Object.entries(given)) files[name] = decoder.decode(bytes)
      return new Uint8Array([0])
    },
  }
}

async function tokenFor(user: TestUser): Promise<string> {
  const client = await w.as(user)
  const { data } = await client.auth.getSession()
  if (!data.session) throw new Error(`no session for ${user.email}`)
  return data.session.access_token
}

async function runBackup(token: string) {
  const files: Record<string, string> = {}
  const req = new Request('http://localhost/functions/v1/export-database-backup', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body:    '{}',
  })
  const res = await handleDatabaseBackup(req, backupDeps(files))
  return { status: res.status, body: await res.json() as Record<string, unknown>, files }
}

describe('scenario: an admin backs the database up', () => {
  it('writes every table to its own CSV, with the shop\'s real rows in them', async () => {
    const diver = await w.person('diver')
    const eventId = await w.dive()
    const bookingId = await w.book({ diver, eventId, total: 3000, deposit: 1000 })
    await w.pay({ bookingId, diver, amount: 1000 })

    const { status, body, files } = await runBackup(await tokenFor(admin))
    expect(status).toBe(200)
    expect(body.ok).toBe(true)

    // One CSV per table the inventory names, and nothing left out of the count.
    const { data: inventory } = await w.admin.rpc('backup_table_inventory' as never)
    const tables = (inventory as unknown as Array<{ table_name: string }>).map(r => r.table_name)
    expect(body.table_count).toBe(tables.length)
    for (const table of tables) expect(files[`${table}.csv`]).toBeDefined()

    // The rows this scenario just made are in the archive, not merely the
    // headers — every table read is a real service_role read through PostgREST.
    expect(files['bookings.csv']).toContain(bookingId)
    expect(files['profiles.csv']).toContain(diver.id)
    expect(files['payments.csv']).toContain(bookingId)
    expect(files['events.csv']).toContain(eventId)

    // A jsonb column survives as JSON rather than as [object Object].
    expect(files['bookings.csv']).toMatch(/"\{""total"":3000/)

    // The manifest counts what the CSVs hold.
    const manifest = new Map(
      files['manifest.csv'].trim().split('\r\n').slice(1)
        .map(line => line.split(',') as [string, string]),
    )
    expect(Number(manifest.get('bookings'))).toBeGreaterThanOrEqual(1)
    expect(files['README.txt']).toContain(`${tables.length} tables`)
  })

  it('pages past PostgREST\'s 1000-row cap rather than stopping at it', async () => {
    // The one table cheap enough to overfill: 1200 attempts against one user.
    const rows = Array.from({ length: 1200 }, () => ({
      user_id: admin.id, action: 'scenario_backup_paging',
    }))
    for (let i = 0; i < rows.length; i += 400) {
      const { error } = await w.admin.from('user_action_attempts').insert(rows.slice(i, i + 400) as never)
      expect(error).toBeNull()
    }

    const { status, files } = await runBackup(await tokenFor(admin))
    expect(status).toBe(200)

    const written = files['user_action_attempts.csv'].trim().split('\r\n')
    const mine = written.filter(line => line.includes('scenario_backup_paging'))
    expect(mine).toHaveLength(1200)
    // Paging by the primary key, so no row is written twice.
    expect(new Set(mine).size).toBe(1200)

    await w.admin.from('user_action_attempts')
      .delete().eq('action', 'scenario_backup_paging')
  })

  it('hands the whole database to nobody below admin', async () => {
    const staff = await w.person('staff')
    const diver = await w.person('diver')

    for (const person of [staff, diver]) {
      const { status, files } = await runBackup(await tokenFor(person))
      expect(status).toBe(403)
      expect(Object.keys(files)).toHaveLength(0)
    }
  })
})
