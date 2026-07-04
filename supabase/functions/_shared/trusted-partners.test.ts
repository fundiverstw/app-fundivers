import { describe, it, expect } from 'vitest'
import {
  parseContactPartnerInput,
  buildTrustedPartnerEmail,
  TRUSTED_PARTNER_MSG_MAX,
} from './trusted-partners'

describe('parseContactPartnerInput', () => {
  it('trims and accepts a valid partner id + message', () => {
    expect(parseContactPartnerInput({ partner_id: '  p1  ', message: '  hello  ' }))
      .toEqual({ request: { partnerId: 'p1', message: 'hello' } })
  })

  it('rejects a missing partner id', () => {
    expect(parseContactPartnerInput({ message: 'hi' })).toEqual({ error: expect.stringMatching(/pick a partner/i) })
  })

  it('rejects a blank message', () => {
    expect(parseContactPartnerInput({ partner_id: 'p1', message: '   ' })).toEqual({ error: expect.stringMatching(/message/i) })
  })

  it('rejects an over-long message', () => {
    const long = 'x'.repeat(TRUSTED_PARTNER_MSG_MAX + 1)
    expect(parseContactPartnerInput({ partner_id: 'p1', message: long })).toEqual({ error: expect.stringMatching(/too long/i) })
  })
})

describe('buildTrustedPartnerEmail', () => {
  it('addresses the partner, names the shop + diver, and embeds the message + reply address', () => {
    const { subject, text } = buildTrustedPartnerEmail({
      shopName: 'FunDivers',
      partnerName: 'Blue Manta',
      diverName: 'Ada (Ace)',
      diverEmail: 'ada@example.com',
      message: 'Coming to Anilao in March — got space?',
    })
    expect(subject).toMatch(/FunDivers/)
    expect(text).toMatch(/Hi Blue Manta,/)
    expect(text).toMatch(/Ada \(Ace\)/)
    expect(text).toMatch(/ada@example\.com/)
    expect(text).toMatch(/Coming to Anilao in March/)
  })

  it('falls back to the diver email when no name is on file', () => {
    const { text } = buildTrustedPartnerEmail({
      shopName: 'FunDivers', partnerName: 'X', diverName: '  ',
      diverEmail: 'nobody@example.com', message: 'hi',
    })
    expect(text).toMatch(/nobody@example\.com/)
  })
})
