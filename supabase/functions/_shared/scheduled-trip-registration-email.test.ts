// Pure helpers for register-scheduled-trip: input parsing + the confirmation email.
import { describe, it, expect } from 'vitest'
import {
  parseRegisterScheduledTripInput, buildScheduledTripRegistrationEmail,
} from './scheduled-trip-registration-email.ts'

describe('parseRegisterScheduledTripInput', () => {
  const ok = { scheduled_trip_id: 's1', addon_ids: ['a1', 'a2'], room_id: 'r1', notes: 'hi' }

  it('accepts and normalises a valid body', () => {
    const res = parseRegisterScheduledTripInput(ok)
    expect('request' in res && res.request).toEqual({
      scheduledTripId: 's1', addonIds: ['a1', 'a2'], roomId: 'r1', notes: 'hi',
    })
  })

  it('defaults an absent room / addons cleanly', () => {
    const res = parseRegisterScheduledTripInput({ ...ok, room_id: undefined, addon_ids: undefined })
    expect('request' in res && res.request.roomId).toBeNull()
    expect('request' in res && res.request.addonIds).toEqual([])
  })

  it('rejects a missing trip id and over-long notes', () => {
    expect(parseRegisterScheduledTripInput({ ...ok, scheduled_trip_id: '' })).toHaveProperty('error')
    expect(parseRegisterScheduledTripInput({ ...ok, notes: 'x'.repeat(3001) })).toHaveProperty('error')
  })
})

describe('buildScheduledTripRegistrationEmail', () => {
  const parts = {
    shopName: 'FunDivers TW', tripTitle: 'Green Island Weekend', tripDates: '2026-09-01 to 2026-09-03',
    addonLabels: ['Nitrox', 'Camera'], roomLabel: 'Deluxe', notes: 'vegetarian',
    diverName: 'Sam Diver', diverEmail: 'sam@example.com', estimateTotal: 15400, currencyLabel: 'TWD',
  }

  it('the shop copy carries the diver, extras, estimate and email', () => {
    const { subject, shopText } = buildScheduledTripRegistrationEmail(parts)
    expect(subject).toContain('Green Island Weekend')
    expect(shopText).toContain('Green Island Weekend')
    expect(shopText).toContain('Sam Diver')
    expect(shopText).toContain('Nitrox, Camera')
    expect(shopText).toContain('Deluxe')
    expect(shopText).toContain('sam@example.com')
    expect(shopText).toContain('TWD 15,400')
  })

  it('the diver copy carries the estimate + confirm-later note', () => {
    const { diverText } = buildScheduledTripRegistrationEmail(parts)
    expect(diverText).toContain('FunDivers TW')
    expect(diverText).toContain('TWD 15,400')
    expect(diverText).toMatch(/estimate/i)
  })

  it('renders "none" with no add-ons or room', () => {
    const { shopText } = buildScheduledTripRegistrationEmail({ ...parts, addonLabels: [], roomLabel: null })
    expect(shopText).toContain('Add-ons: none')
    expect(shopText).toContain('Room option: none')
  })
})
