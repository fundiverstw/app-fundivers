import { describe, it, expect } from 'vitest'
import {
  parsePartnerConnectInput,
  buildPartnerConnectEmail,
  PARTNER_CONNECT_MAX,
} from './partner-connect'

describe('parsePartnerConnectInput', () => {
  it('trims and accepts a valid destination + note', () => {
    expect(parsePartnerConnectInput({ destination: '  Cebu, Philippines  ', note: '  next March  ' }))
      .toEqual({ request: { destination: 'Cebu, Philippines', note: 'next March' } })
  })

  it('defaults a missing/blank note to empty string', () => {
    expect(parsePartnerConnectInput({ destination: 'Okinawa' }))
      .toEqual({ request: { destination: 'Okinawa', note: '' } })
  })

  it('rejects a missing or blank destination', () => {
    expect(parsePartnerConnectInput({})).toEqual({ error: expect.any(String) })
    expect(parsePartnerConnectInput({ destination: '   ' })).toEqual({ error: expect.any(String) })
    expect(parsePartnerConnectInput({ destination: 42 })).toEqual({ error: expect.any(String) })
  })

  it('rejects over-long destination or note', () => {
    expect(parsePartnerConnectInput({ destination: 'x'.repeat(PARTNER_CONNECT_MAX.destination + 1) }))
      .toEqual({ error: expect.any(String) })
    expect(parsePartnerConnectInput({ destination: 'Bali', note: 'y'.repeat(PARTNER_CONNECT_MAX.note + 1) }))
      .toEqual({ error: expect.any(String) })
  })
})

describe('buildPartnerConnectEmail', () => {
  it('includes diver, destination and note in subject + body', () => {
    const { subject, text } = buildPartnerConnectEmail({
      diverName: 'Ada Lovelace',
      diverEmail: 'ada@example.com',
      destination: 'Cebu',
      note: 'going in March',
    })
    expect(subject).toContain('Ada Lovelace')
    expect(subject).toContain('Cebu')
    expect(text).toContain('Ada Lovelace')
    expect(text).toContain('ada@example.com')
    expect(text).toContain('Cebu')
    expect(text).toContain('going in March')
  })

  it('falls back to email when the diver has no name, and marks an empty note', () => {
    const { subject, text } = buildPartnerConnectEmail({
      diverName: '   ',
      diverEmail: 'ada@example.com',
      destination: 'Bali',
      note: '',
    })
    expect(subject).toContain('ada@example.com')
    expect(text).toContain('Note: (none)')
  })
})
