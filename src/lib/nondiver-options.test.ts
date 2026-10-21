import { describe, it, expect } from 'vitest'
import { DIVER, participantPricing, sortNondiverOptions } from './nondiver-options'

const event = { price: 3200, deposit_amount: 1000 }
const options = [
  { id: 'nd1', price: 1500, deposit_amount: 500 },
  { id: 'nd2', price: 800, deposit_amount: null },
]

describe('participantPricing', () => {
  it('prices a diver at the event figures', () => {
    expect(participantPricing(DIVER, options, event)).toEqual({ base: 3200, depositAmount: 1000, option: null })
  })

  it('prices an option at its own price and deposit', () => {
    expect(participantPricing('nd1', options, event)).toEqual({ base: 1500, depositAmount: 500, option: 'nd1' })
  })

  it('gives an option without a deposit none, not the diver deposit', () => {
    expect(participantPricing('nd2', options, event)).toEqual({ base: 800, depositAmount: 0, option: 'nd2' })
  })

  it('falls back to the diver figures for an option it cannot find', () => {
    expect(participantPricing('gone', options, event)).toEqual({ base: 3200, depositAmount: 1000, option: null })
  })

  it('treats a missing event price as zero', () => {
    expect(participantPricing(DIVER, [], {})).toEqual({ base: 0, depositAmount: 0, option: null })
  })
})

describe('sortNondiverOptions', () => {
  it('orders by the shop sort order, then by name', () => {
    const rows = [
      { sort_order: 1, label: 'Boat passenger' },
      { sort_order: 0, label: 'Snorkeler' },
      { sort_order: 0, label: 'Freediver' },
    ]
    expect(sortNondiverOptions(rows).map(r => r.label)).toEqual(['Freediver', 'Snorkeler', 'Boat passenger'])
  })
})
