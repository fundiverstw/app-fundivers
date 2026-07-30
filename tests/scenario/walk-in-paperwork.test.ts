import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { world, ledger, teardownWorld, type World, type Ledger } from './world'

// The walk-in: someone turns up at the shop, an admin does everything for them,
// and the paperwork has to end up on record anyway.
//
// This is the journey with the most moving parts and the least UI to catch a
// mistake — the diver never logs in, so nothing in the app ever prompts them.
// Consent arrives by emailed link and the liability release on paper.

let w: World
const l: Ledger = ledger()

beforeAll(async () => { w = await world(l) })
afterAll(async () => { await teardownWorld(l) })

describe('scenario: a walk-in agrees to the terms without ever signing in', () => {
  it('starts with no consent, and the emailed link records it', async () => {
    const walkIn = await w.person('diver')
    // An admin-minted account records nothing: there is no checkbox to tick.
    await w.admin.from('profiles')
      .update({ agreed_to_terms_at: null, agreed_to_terms_version: null } as never)
      .eq('id', walkIn.id)
    expect((await w.termsConsentOf(walkIn)).agreed_to_terms_at).toBeNull()

    const token = await w.termsLink(walkIn)
    const anon = w.anon()

    // The page checks the link before showing the document.
    const state = await anon.rpc('terms_consent_token_state', { p_token: token })
    expect(state.data).toBe('valid')

    // They tap "I agree" with no session at all.
    const accepted = await anon.rpc('accept_terms_with_token', { p_token: token })
    expect(accepted.error).toBeNull()
    expect(Number(accepted.data)).toBe(await w.termsVersion())

    const consent = await w.termsConsentOf(walkIn)
    expect(consent.agreed_to_terms_at).not.toBeNull()
    expect(consent.agreed_to_terms_version).toBe(await w.termsVersion())
  })

  it('burns the link, so a forwarded email cannot re-consent for them', async () => {
    const walkIn = await w.person('diver')
    const token = await w.termsLink(walkIn)
    const anon = w.anon()

    expect((await anon.rpc('accept_terms_with_token', { p_token: token })).error).toBeNull()
    const first = await w.termsConsentOf(walkIn)

    expect((await anon.rpc('accept_terms_with_token', { p_token: token })).error).not.toBeNull()
    expect((await anon.rpc('terms_consent_token_state', { p_token: token })).data).toBe('used')
    // The original stamp stands; the replay changed nothing.
    expect((await w.termsConsentOf(walkIn)).agreed_to_terms_at).toBe(first.agreed_to_terms_at)
  })

  it('refuses an expired link and leaves consent unrecorded', async () => {
    const walkIn = await w.person('diver')
    await w.admin.from('profiles')
      .update({ agreed_to_terms_at: null, agreed_to_terms_version: null } as never)
      .eq('id', walkIn.id)
    const token = await w.termsLink(walkIn, -1)

    const anon = w.anon()
    expect((await anon.rpc('terms_consent_token_state', { p_token: token })).data).toBe('expired')
    expect((await anon.rpc('accept_terms_with_token', { p_token: token })).error).not.toBeNull()
    expect((await w.termsConsentOf(walkIn)).agreed_to_terms_at).toBeNull()
  })
})

describe('scenario: the walk-in signs the liability release on paper', () => {
  it('an admin records it against them, marked as a paper form', async () => {
    const walkIn = await w.person('diver')
    const { code, version } = await w.waiver()

    expect(await w.signaturesOf(walkIn)).toEqual([])

    const db = await w.as(w.adminUser)
    const { error } = await db.rpc('admin_record_paper_waiver', {
      p_diver_id: walkIn.id, p_code: code, p_version: version,
      p_signed_name: 'Jane Diver',
    })
    expect(error).toBeNull()

    const signatures = await w.signaturesOf(walkIn)
    expect(signatures).toHaveLength(1)
    // A paper record must never read like the diver e-signed it.
    expect(signatures[0].method).toBe('in_person')
    expect(signatures[0].recorded_by).toBe(w.adminUser.id)
    expect(signatures[0].signed_name).toBe('Jane Diver')
  })

  it('a diver signing in the app is recorded as an e-signature instead', async () => {
    const diver = await w.person('diver')
    const { code, version } = await w.waiver()

    const db = await w.as(diver)
    const { error } = await db.rpc('sign_waiver', {
      p_code: code, p_version: version, p_signed_name: 'Grace Hopper', p_event_id: null,
    })
    expect(error).toBeNull()

    const signatures = await w.signaturesOf(diver)
    expect(signatures[0].method).toBe('e_signed')
    expect(signatures[0].recorded_by).toBeNull()
  })

  it('only an admin can record a paper waiver for someone else', async () => {
    const diver = await w.person('diver')
    const staff = await w.person('staff')
    const { code, version } = await w.waiver()

    for (const actor of [diver, staff]) {
      const db = await w.as(actor)
      const { error } = await db.rpc('admin_record_paper_waiver', {
        p_diver_id: diver.id, p_code: code, p_version: version, p_signed_name: 'Nope',
      })
      expect(error).not.toBeNull()
    }
    expect(await w.signaturesOf(diver)).toEqual([])
  })
})

describe('scenario: the walk-in gets booked onto a dive', () => {
  it('an admin registers them and takes cash at the shop', async () => {
    const walkIn = await w.person('diver')
    const eventId = await w.dive()

    const bookingId = await w.book({ diver: walkIn, eventId, total: 2500, deposit: 500 })
    await w.pay({ bookingId, diver: walkIn, amount: 2500 })

    const { data: payments } = await w.admin.from('payments')
      .select('amount, status').eq('booking_id', bookingId)
    expect((payments ?? []).map(p => Number((p as { amount: number }).amount))).toEqual([2500])
    expect(await w.bookingStatus(bookingId)).toBe('confirmed')
  })
})
