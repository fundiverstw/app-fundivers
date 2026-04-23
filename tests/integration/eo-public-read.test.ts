import { describe, it, expect } from 'vitest'
import { adminClient, anonClient } from './helpers'

// The Wix marketing site fetches EO_dives, EO_courses, EO_prices, EO_rooms,
// and Other_Addons via the anon key. These tests pin the contract:
// anon can SELECT but cannot mutate.

const admin = adminClient()
const anon = anonClient()

const PUBLIC_READ_TABLES = ['EO_dives', 'EO_courses', 'EO_prices', 'EO_rooms', 'Other_Addons'] as const

describe('EO_* public read policies', () => {
  for (const table of PUBLIC_READ_TABLES) {
    it(`${table}: anon can select`, async () => {
      const { data, error } = await anon.from(table as never).select('_id').limit(1)
      expect(error).toBeNull()
      expect(data).not.toBeNull()
    })

    it(`${table}: anon cannot insert`, async () => {
      const { error } = await anon.from(table as never).insert({ _id: `anon_insert_test_${Date.now()}` } as never)
      expect(error).not.toBeNull()
    })

    it(`${table}: anon cannot delete`, async () => {
      // Grab any real row id then try to delete it as anon.
      const { data } = await admin.from(table as never).select('_id').limit(1)
      const firstRow = (data ?? [])[0] as { _id?: string } | undefined
      if (!firstRow?._id) return // empty table in local → nothing to test against
      const { error, count } = await anon.from(table as never).delete({ count: 'exact' }).eq('_id', firstRow._id)
      // RLS quietly returns 0 affected rows rather than raising, depending on
      // client version — either outcome is acceptable as long as nothing deletes.
      expect(error !== null || count === 0).toBe(true)
      const { data: stillThere } = await admin.from(table as never).select('_id').eq('_id', firstRow._id).maybeSingle()
      expect(stillThere).not.toBeNull()
    })
  }
})
