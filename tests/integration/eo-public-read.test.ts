import { describe, it, expect } from 'vitest'
import { adminClient, anonClient } from './helpers'

// The public marketing surface reads events, prices, rooms, and
// addons via the anon key. These tests pin the contract: anon can
// SELECT but cannot mutate.

const admin = adminClient()
const anon = anonClient()

// Legacy catalog tables still keyed by text/uuid id.
const PUBLIC_READ_TABLES = ['prices', 'rooms', 'addons'] as const

describe('EO_* public read policies', () => {
  for (const table of PUBLIC_READ_TABLES) {
    it(`${table}: anon can select`, async () => {
      const { data, error } = await anon.from(table as never).select('id').limit(1)
      expect(error).toBeNull()
      expect(data).not.toBeNull()
    })

    it(`${table}: anon cannot insert`, async () => {
      const { error } = await anon.from(table as never).insert({ id: `anon_insert_test_${Date.now()}` } as never)
      expect(error).not.toBeNull()
    })

    it(`${table}: anon cannot delete`, async () => {
      // Grab any real row id then try to delete it as anon.
      const { data } = await admin.from(table as never).select('id').limit(1)
      const firstRow = (data ?? [])[0] as { id?: string } | undefined
      if (!firstRow?.id) return // empty table in local → nothing to test against
      const { error, count } = await anon.from(table as never).delete({ count: 'exact' }).eq('id', firstRow.id)
      // RLS quietly returns 0 affected rows rather than raising, depending on
      // client version — either outcome is acceptable as long as nothing deletes.
      expect(error !== null || count === 0).toBe(true)
      const { data: stillThere } = await admin.from(table as never).select('id').eq('id', firstRow.id).maybeSingle()
      expect(stillThere).not.toBeNull()
    })
  }
})

describe('events public read policy', () => {
  it('anon can select', async () => {
    const { data, error } = await anon.from('events' as never).select('id').limit(1)
    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })

  it('anon cannot insert', async () => {
    const { error } = await anon.from('events' as never)
      .insert({ id: crypto.randomUUID(), kind: 'dive' } as never)
    expect(error).not.toBeNull()
  })

  it('anon cannot delete', async () => {
    const { data } = await admin.from('events' as never).select('id').limit(1)
    const firstRow = (data ?? [])[0] as { id?: string } | undefined
    if (!firstRow?.id) return // empty table in local → nothing to test against
    const { error, count } = await anon.from('events' as never).delete({ count: 'exact' }).eq('id', firstRow.id)
    expect(error !== null || count === 0).toBe(true)
    const { data: stillThere } = await admin.from('events' as never).select('id').eq('id', firstRow.id).maybeSingle()
    expect(stillThere).not.toBeNull()
  })
})
