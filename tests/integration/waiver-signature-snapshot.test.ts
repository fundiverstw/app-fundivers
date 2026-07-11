import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import { adminClient, userClient, createTestUser, deleteTestUser, type TestUser } from './helpers'

// Pins the content-snapshot contract from 20260711200000: sign_waiver() records,
// in the same transaction as the signature, the exact waiver content the diver
// agreed to plus a SHA-256 of it — so a later edit to the waiver can't rewrite
// what a past signer saw.

const admin = adminClient()
let diver: TestUser

beforeAll(async () => { diver = await createTestUser(admin, { role: 'diver' }) })
afterAll(async () => { if (diver) await deleteTestUser(admin, diver.id) })

describe('sign_waiver content snapshot', () => {
  it('snapshots the exact content + a matching SHA-256 at signing time', async () => {
    // A text (body) waiver from the seed catalog.
    const { data: w } = await admin
      .from('waivers').select('code, version, title, body').not('body', 'is', null).limit(1).single()
    expect(w).not.toBeNull()

    const sb = await userClient(diver.email, diver.password)
    const { data: sigId, error } = await sb.rpc('sign_waiver', {
      p_code: w!.code, p_version: w!.version, p_signed_name: 'Test Diver',
    })
    expect(error).toBeNull()

    const { data: sig } = await admin
      .from('waiver_signatures')
      .select('signed_title, signed_body, content_sha256, signed_name')
      .eq('id', sigId as string).single()

    expect(sig!.signed_title).toBe(w!.title)
    expect(sig!.signed_body).toBe(w!.body)
    expect(sig!.signed_name).toBe('Test Diver')
    const expected = createHash('sha256').update(w!.body as string, 'utf8').digest('hex')
    expect(sig!.content_sha256).toBe(expected)
  })

  it('is tamper-evident: editing the waiver afterwards does not change the stored snapshot', async () => {
    const { data: w } = await admin
      .from('waivers').select('code, version, title, body').not('body', 'is', null).limit(1).single()
    const sb = await userClient(diver.email, diver.password)
    const { data: sigId } = await sb.rpc('sign_waiver', {
      p_code: w!.code, p_version: w!.version, p_signed_name: 'Snapshot Check',
    })
    const { data: before } = await admin
      .from('waiver_signatures').select('signed_body, content_sha256').eq('id', sigId as string).single()

    // Admin edits the live waiver body.
    await admin.from('waivers').update({ body: (w!.body as string) + '\n\nEDITED LATER' }).eq('code', w!.code)

    const { data: after } = await admin
      .from('waiver_signatures').select('signed_body, content_sha256').eq('id', sigId as string).single()
    expect(after!.signed_body).toBe(before!.signed_body)
    expect(after!.content_sha256).toBe(before!.content_sha256)

    // Restore the waiver body so other suites see the seed value.
    await admin.from('waivers').update({ body: w!.body }).eq('code', w!.code)
  })
})
