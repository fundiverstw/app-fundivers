// Pure helpers for register-package: input parsing + the recommendation email.
import { describe, it, expect } from 'vitest'
import { parseRegisterPackageInput, buildPackageRegistrationEmail } from './package-registration-email.ts'

describe('parseRegisterPackageInput', () => {
  const ok = {
    package_id: 'p1', tier_id: 't1', preferred_start: '2026-08-01', preferred_end: '2026-08-05',
    addon_ids: ['a1', 'a2'], room_id: 'r1', notes: 'hi',
  }

  it('accepts and normalises a valid body', () => {
    const res = parseRegisterPackageInput(ok)
    expect('request' in res && res.request).toEqual({
      packageId: 'p1', tierId: 't1', preferredStart: '2026-08-01', preferredEnd: '2026-08-05',
      addonIds: ['a1', 'a2'], roomId: 'r1', notes: 'hi',
    })
  })

  it('defaults an absent room / addons cleanly', () => {
    const res = parseRegisterPackageInput({ ...ok, room_id: undefined, addon_ids: undefined })
    expect('request' in res && res.request.roomId).toBeNull()
    expect('request' in res && res.request.addonIds).toEqual([])
  })

  it('rejects missing tier, missing dates, a reversed range, and a same-day range', () => {
    expect(parseRegisterPackageInput({ ...ok, tier_id: '' })).toHaveProperty('error')
    expect(parseRegisterPackageInput({ ...ok, preferred_start: '' })).toHaveProperty('error')
    expect(parseRegisterPackageInput({ ...ok, preferred_start: '2026-08-09' })).toHaveProperty('error')
    // A same-day range would zero out per-night room pricing, so require >= 1 night.
    expect(parseRegisterPackageInput({ ...ok, preferred_end: ok.preferred_start })).toHaveProperty('error')
  })

  it('rejects a non-YYYY-MM-DD date', () => {
    expect(parseRegisterPackageInput({ ...ok, preferred_end: '08/05/2026' })).toHaveProperty('error')
  })
})

describe('buildPackageRegistrationEmail', () => {
  const parts = {
    shopName: 'FunDivers TW', partnerName: 'Blue Manta', productTitle: 'Anilao Week', tierName: 'Package B',
    addonLabels: ['Nitrox', 'Camera'], roomLabel: 'Deluxe',
    preferredStart: '2026-08-01', preferredEnd: '2026-08-05', nights: 4,
    notes: 'vegetarian', diverName: 'Sam Diver', diverEmail: 'sam@example.com',
    estimateTotal: 21300, currencyLabel: 'TWD',
  }

  it('addresses the partner and carries the product, tier, estimate and disclaimer', () => {
    const { subject, partnerText } = buildPackageRegistrationEmail(parts)
    expect(subject).toContain('Anilao Week')
    expect(subject).toContain('Package B')
    expect(partnerText).toContain('Hi Blue Manta,')
    expect(partnerText).toContain('Hello from FunDivers TW')
    expect(partnerText).toContain('Anilao Week')
    expect(partnerText).toContain('Package B')
    expect(partnerText).toContain('Nitrox, Camera')
    expect(partnerText).toContain('Deluxe')
    expect(partnerText).toContain('sam@example.com')
    expect(partnerText).toContain('TWD 21,300')
    expect(partnerText).toMatch(/final cost will be determined by your shop/i)
  })

  it('the diver copy also carries the estimate and disclaimer', () => {
    const { diverText } = buildPackageRegistrationEmail(parts)
    expect(diverText).toContain('Blue Manta')
    expect(diverText).toContain('TWD 21,300')
    expect(diverText).toMatch(/estimate only/i)
  })

  it('renders "none" when there are no add-ons or room', () => {
    const { partnerText } = buildPackageRegistrationEmail({ ...parts, addonLabels: [], roomLabel: null })
    expect(partnerText).toContain('Add-ons: none')
    expect(partnerText).toContain('Room option: none')
  })
})
