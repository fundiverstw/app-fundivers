// Pure helpers for register-package: input parsing + the recommendation email.
import { describe, it, expect } from 'vitest'
import { parseRegisterPackageInput, buildPackageRegistrationEmail } from './package-registration-email.ts'
import { t } from './i18n.ts'

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

  // The partner is a third-party shop abroad; its copy must stay English no
  // matter what shop-facing language the deployment picked. These assertions are
  // deliberately hardcoded English — that IS the contract.
  it('addresses the partner in English and carries the product, tier, estimate and disclaimer', () => {
    const { partnerSubject, partnerText } = buildPackageRegistrationEmail(parts)
    expect(partnerSubject).toContain('Anilao Week')
    expect(partnerSubject).toContain('Package B')
    expect(partnerSubject).toContain('a diver for')
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

  // The diver is the shop's own customer, so their copy follows the catalog.
  it('the diver copy is translated and carries the estimate and disclaimer', () => {
    const d = t.emails.packageReg
    const { diverSubject, diverText } = buildPackageRegistrationEmail(parts)
    expect(diverSubject).toBe(d.diverSubject('FunDivers TW', 'Anilao Week', 'Package B'))
    expect(diverText).toContain('Blue Manta')
    expect(diverText).toContain('TWD 21,300')
    expect(diverText).toContain(d.disclaimer)
    expect(diverText).toContain(d.greeting('Sam Diver'))
  })

  it('renders the English "none" to the partner and the translated one to the diver', () => {
    const { partnerText, diverText } = buildPackageRegistrationEmail({ ...parts, addonLabels: [], roomLabel: null })
    expect(partnerText).toContain('Add-ons: none')
    expect(partnerText).toContain('Room option: none')
    expect(diverText).toContain(t.emails.packageReg.addons(t.emails.common.none))
    expect(diverText).toContain(t.emails.packageReg.room(t.emails.common.none))
  })
})
