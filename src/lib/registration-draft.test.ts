import { describe, it, expect, beforeEach } from 'vitest'
import {
  registrationDraftKey,
  saveRegistrationDraft,
  loadRegistrationDraft,
  clearRegistrationDraft,
  listRegistrationDrafts,
  REGISTRATION_DRAFT_PREFIX,
  type RegistrationDraft,
} from './registration-draft'

function makeDraft(over: Partial<RegistrationDraft> = {}): RegistrationDraft {
  return {
    savedAt: Date.now(),
    step: 2,
    fullName: 'Ada Lovelace',
    nickname: 'Ace',
    dob: '1990-12-10',
    nationality: 'UK',
    gender: 'female',
    idNumber: 'A123',
    contactMethod: 'line',
    contactId: 'ada_dives',
    certAgency: 'PADI',
    certLevel: 'AOW',
    loggedDives: 42,
    nitroxCertified: true,
    deepCertified: false,
    emergencyName: 'Charles',
    emergencyPhone: '0900',
    guestEmail: '',
    guestAgreedTerms: false,
    gearChoice: 'rent',
    gearHelpNote: '',
    editedGearItems: ['Fins', 'Wetsuit'],
    shoeSize: '42',
    heightCm: '170',
    weightKg: '65',
    roomId: 'r1',
    roomNotes: 'sea view',
    addonIds: ['a1', 'a2'],
    needsTransport: true,
    addNitroxCourse: false,
    payment: 'bank_transfer',
    creditCardInvoiceEmail: '',
    payForEveryone: true,
    useAccountCredit: true,
    payDepositOnly: false,
    notes: 'see you there',
    ...over,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('registrationDraftKey', () => {
  it('namespaces by event type, id, and target', () => {
    expect(registrationDraftKey('dive', 'evt1', 'user9'))
      .toBe(`${REGISTRATION_DRAFT_PREFIX}:dive:evt1:user9`)
  })

  it('falls back to a shared guest slot when there is no target', () => {
    expect(registrationDraftKey('course', 'c2', null))
      .toBe(`${REGISTRATION_DRAFT_PREFIX}:course:c2:guest`)
  })
})

describe('save / load / clear', () => {
  it('round-trips a draft', () => {
    const key = registrationDraftKey('dive', 'evt1', 'user9')
    const draft = makeDraft()
    saveRegistrationDraft(key, draft)
    expect(loadRegistrationDraft(key)).toEqual(draft)
  })

  it('returns null for a missing key', () => {
    expect(loadRegistrationDraft('nope')).toBeNull()
  })

  it('clears a draft', () => {
    const key = registrationDraftKey('dive', 'evt1', 'user9')
    saveRegistrationDraft(key, makeDraft())
    clearRegistrationDraft(key)
    expect(loadRegistrationDraft(key)).toBeNull()
  })

  it('drops and expires a draft older than the max age', () => {
    const key = registrationDraftKey('dive', 'evt1', 'user9')
    const stale = makeDraft({ savedAt: Date.now() - 15 * 24 * 60 * 60 * 1000 })
    saveRegistrationDraft(key, stale)
    expect(loadRegistrationDraft(key)).toBeNull()
    // Expiry is destructive so listing never resurfaces it.
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('discards corrupt JSON without throwing', () => {
    const key = registrationDraftKey('dive', 'evt1', 'user9')
    localStorage.setItem(key, '{not json')
    expect(loadRegistrationDraft(key)).toBeNull()
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('coerces a partial / legacy-shaped draft to safe defaults', () => {
    const key = registrationDraftKey('dive', 'evt1', 'user9')
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), fullName: 'Grace', step: 99 }))
    const loaded = loadRegistrationDraft(key)
    expect(loaded).not.toBeNull()
    expect(loaded!.fullName).toBe('Grace')
    // Out-of-range step falls back to 1; missing arrays/bools get empty defaults.
    expect(loaded!.step).toBe(1)
    expect(loaded!.addonIds).toEqual([])
    expect(loaded!.editedGearItems).toBeNull()
    expect(loaded!.needsTransport).toBeNull()
    expect(loaded!.nitroxCertified).toBe(false)
    // Opt-out toggles default to on (match the form defaults).
    expect(loaded!.payForEveryone).toBe(true)
    expect(loaded!.useAccountCredit).toBe(true)
  })
})

describe('listRegistrationDrafts', () => {
  it('returns every live draft with its parsed event coordinates', () => {
    saveRegistrationDraft(registrationDraftKey('dive', 'evt1', 'user9'), makeDraft())
    saveRegistrationDraft(registrationDraftKey('course', 'c2', null), makeDraft())
    localStorage.setItem('unrelated_key', 'x')

    const drafts = listRegistrationDrafts()
    expect(drafts).toHaveLength(2)
    expect(drafts).toContainEqual(expect.objectContaining({ eventType: 'dive', eventId: 'evt1' }))
    expect(drafts).toContainEqual(expect.objectContaining({ eventType: 'course', eventId: 'c2' }))
  })

  it('skips expired drafts', () => {
    saveRegistrationDraft(registrationDraftKey('dive', 'fresh', 'u1'), makeDraft())
    saveRegistrationDraft(
      registrationDraftKey('dive', 'stale', 'u1'),
      makeDraft({ savedAt: Date.now() - 30 * 24 * 60 * 60 * 1000 }),
    )
    const drafts = listRegistrationDrafts()
    expect(drafts.map(d => d.eventId)).toEqual(['fresh'])
  })
})
