import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'
import type { BookingDetails } from '../types/database'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))

vi.mock('./supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

beforeEach(() => {
  from.mockReset()
})

function tableMock(rows: Record<string, { data?: unknown; error?: unknown }>) {
  from.mockImplementation((table: string) => {
    if (!(table in rows)) throw new Error(`unexpected table: ${table}`)
    return mockQueryBuilder(rows[table])
  })
}

const details = (d: Partial<BookingDetails>): BookingDetails => d as BookingDetails

describe('fetchChargeCatalog', () => {
  it('resolves known room and add-on ids to their label + amount', async () => {
    tableMock({
      rooms: { data: [{ id: 'r1', display_title: 'Deluxe', admin_title: 'deluxe-admin', added_price: 1500 }] },
      addons: { data: [{ id: 'a1', display_title: 'Camera', admin_title: 'cam-admin', price: 300 }] },
    })
    const { fetchChargeCatalog } = await import('./booking-charge-catalog')

    const catalog = await fetchChargeCatalog([
      details({ room: { option_id: 'r1' }, add_ons: ['a1'] }),
    ])

    expect(catalog.roomPrices.get('r1')).toEqual({ label: 'Deluxe', amount: 1500 })
    expect(catalog.addonPrices.get('a1')).toEqual({ label: 'Camera', amount: 300 })
  })

  it('falls back to admin_title then id when display_title is null/empty', async () => {
    tableMock({
      rooms: {
        data: [
          { id: 'r1', display_title: null, admin_title: 'Admin Room', added_price: 100 },
          { id: 'r2', display_title: '', admin_title: null, added_price: 200 },
        ],
      },
      addons: { data: [] },
    })
    const { fetchChargeCatalog } = await import('./booking-charge-catalog')

    const catalog = await fetchChargeCatalog([details({ room: { option_id: 'r1' } }), details({ room: { option_id: 'r2' } })])

    expect(catalog.roomPrices.get('r1')?.label).toBe('Admin Room')
    expect(catalog.roomPrices.get('r2')?.label).toBe('r2')
  })

  it('treats a null price/added_price as amount 0', async () => {
    tableMock({
      rooms: { data: [{ id: 'r1', display_title: 'Free Room', admin_title: null, added_price: null }] },
      addons: { data: [{ id: 'a1', display_title: 'Free Addon', admin_title: null, price: null }] },
    })
    const { fetchChargeCatalog } = await import('./booking-charge-catalog')

    const catalog = await fetchChargeCatalog([details({ room: { option_id: 'r1' }, add_ons: ['a1'] })])

    expect(catalog.roomPrices.get('r1')).toEqual({ label: 'Free Room', amount: 0 })
    expect(catalog.addonPrices.get('a1')).toEqual({ label: 'Free Addon', amount: 0 })
  })

  it('drops ids that are referenced but absent from the fetched rows (no fallback entry)', async () => {
    tableMock({
      rooms: { data: [] },
      addons: { data: [] },
    })
    const { fetchChargeCatalog } = await import('./booking-charge-catalog')

    const catalog = await fetchChargeCatalog([details({ room: { option_id: 'missing' }, add_ons: ['gone'] })])

    expect(catalog.roomPrices.has('missing')).toBe(false)
    expect(catalog.addonPrices.has('gone')).toBe(false)
    expect(catalog.roomPrices.size).toBe(0)
    expect(catalog.addonPrices.size).toBe(0)
  })

  it('de-duplicates repeated room and add-on ids before querying', async () => {
    const inSpies: Record<string, ReturnType<typeof vi.fn>> = {}
    from.mockImplementation((table: string) => {
      const inSpy = vi.fn(() => Promise.resolve({ data: [], error: null }))
      inSpies[table] = inSpy
      return { select: () => ({ in: inSpy }) }
    })
    const { fetchChargeCatalog } = await import('./booking-charge-catalog')

    await fetchChargeCatalog([
      details({ room: { option_id: 'r1' }, add_ons: ['a1', 'a2'] }),
      details({ room: { option_id: 'r1' }, add_ons: ['a1'] }),
    ])

    expect(inSpies.rooms).toHaveBeenCalledWith('id', ['r1'])
    expect(inSpies.addons).toHaveBeenCalledWith('id', ['a1', 'a2'])
  })

  it('does not query a table when no ids of that kind are referenced', async () => {
    tableMock({
      addons: { data: [{ id: 'a1', display_title: 'Camera', admin_title: null, price: 300 }] },
    })
    const { fetchChargeCatalog } = await import('./booking-charge-catalog')

    const catalog = await fetchChargeCatalog([details({ add_ons: ['a1'] })])

    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('addons')
    expect(catalog.roomPrices.size).toBe(0)
    expect(catalog.addonPrices.get('a1')).toEqual({ label: 'Camera', amount: 300 })
  })

  it('returns empty maps and issues no query when nothing is referenced', async () => {
    const { fetchChargeCatalog } = await import('./booking-charge-catalog')

    const catalog = await fetchChargeCatalog([])

    expect(from).not.toHaveBeenCalled()
    expect(catalog.roomPrices.size).toBe(0)
    expect(catalog.addonPrices.size).toBe(0)
  })

  it('ignores null/undefined details and falsy ids when collecting', async () => {
    tableMock({
      rooms: { data: [{ id: 'r1', display_title: 'Deluxe', admin_title: null, added_price: 1500 }] },
      addons: { data: [{ id: 'a1', display_title: 'Camera', admin_title: null, price: 300 }] },
    })
    const { fetchChargeCatalog } = await import('./booking-charge-catalog')

    const catalog = await fetchChargeCatalog([
      null,
      undefined,
      details({ room: { option_id: null }, add_ons: ['', 'a1'] }),
      details({ room: { option_id: 'r1' } }),
    ])

    expect(catalog.roomPrices.size).toBe(1)
    expect(catalog.roomPrices.get('r1')?.amount).toBe(1500)
    expect(catalog.addonPrices.size).toBe(1)
    expect(catalog.addonPrices.get('a1')?.amount).toBe(300)
  })

  it('yields empty maps when supabase returns null data (e.g. an error response)', async () => {
    tableMock({
      rooms: { data: null, error: { message: 'boom' } },
      addons: { data: null, error: { message: 'boom' } },
    })
    const { fetchChargeCatalog } = await import('./booking-charge-catalog')

    const catalog = await fetchChargeCatalog([details({ room: { option_id: 'r1' }, add_ons: ['a1'] })])

    expect(catalog.roomPrices.size).toBe(0)
    expect(catalog.addonPrices.size).toBe(0)
  })
})
