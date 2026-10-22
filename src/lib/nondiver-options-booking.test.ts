import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

import { fetchNondiverOptionsForBooking } from './nondiver-options'

// What the register form offers an admin editing an existing booking. The pin:
// a booking made under an option the event no longer offers must still find it,
// or saving the edit re-prices the person as a diver.

const RETIRED = {
  id: 'nd-old', created_at: '', created_by: null, label: 'Boat ride',
  description: null, price: 900, deposit_amount: 300, active: false, sort_order: 0,
}

function tables(links: unknown[], option: unknown) {
  from.mockImplementation((table: string) => {
    if (table === 'event_nondiver_options') return mockQueryBuilder({ data: links })
    if (table === 'nondiver_options') return mockQueryBuilder({ data: option })
    return mockQueryBuilder()
  })
}

beforeEach(() => { from.mockReset() })

describe('fetchNondiverOptionsForBooking', () => {
  it('adds a retired option the booking was made under, with its catalog fee and deposit', async () => {
    tables([], RETIRED)
    const opts = await fetchNondiverOptionsForBooking('e1', {
      nondiver_option: { id: 'nd-old', label: 'Boat ride' },
    })
    expect(opts).toEqual([RETIRED])
  })

  it('rebuilds a deleted option from the booking snapshot: its label and frozen fee', async () => {
    tables([], null)
    const opts = await fetchNondiverOptionsForBooking('e1', {
      nondiver_option: { id: 'nd-old', label: 'Boat ride' },
      charges: [{ kind: 'base', label: 'Non-diver: Boat ride', amount: 850 }],
    })
    expect(opts).toHaveLength(1)
    expect(opts[0]).toMatchObject({ id: 'nd-old', label: 'Boat ride', price: 850, deposit_amount: null })
  })

  it('adds nothing for a diver booking', async () => {
    tables([], RETIRED)
    expect(await fetchNondiverOptionsForBooking('e1', {})).toEqual([])
  })
})
