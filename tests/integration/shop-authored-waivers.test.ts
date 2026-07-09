import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

// Coverage for the shop-authored waivers feature (20260709120000):
//   - `waivers` is diver-readable reference data, admin-only writable
//   - the content CHECK forces exactly one of body / pdf_path
//   - `cancellation_policies` gained an id default + language/active, same
//     admin-write / public-read shape
//   - the private `waiver-pdfs` bucket: admins write, any authenticated diver
//     reads, anon is denied
// Runs against the live local Supabase stack.

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser
const suffix = () => Math.random().toString(36).slice(2, 10)
const createdWaiverIds: string[] = []
const createdPolicyIds: string[] = []
const pdfPaths: string[] = []

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver     = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  if (createdWaiverIds.length) await admin.from('waivers').delete().in('id', createdWaiverIds)
  if (createdPolicyIds.length) await admin.from('cancellation_policies').delete().in('id', createdPolicyIds)
  if (pdfPaths.length) await admin.storage.from('waiver-pdfs').remove(pdfPaths)
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (diver)     await deleteTestUser(admin, diver.id)
})

describe('waivers table RLS + constraints', () => {
  it('an admin can create a waiver; a diver and anon cannot', async () => {
    const adminSb = await userClient(adminUser.email, adminUser.password)
    const code = `test_wv_${suffix()}`
    const { data, error } = await adminSb.from('waivers')
      .insert({ code, title: 'Test Waiver', body: 'I accept the risks.' }).select('id').single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    if (data?.id) createdWaiverIds.push(data.id)

    const diverSb = await userClient(diver.email, diver.password)
    const diverIns = await diverSb.from('waivers').insert({ code: `test_wv_${suffix()}`, title: 'Nope', body: 'x' })
    expect(diverIns.error).not.toBeNull()

    const anonIns = await anonClient().from('waivers').insert({ code: `test_wv_${suffix()}`, title: 'Nope', body: 'x' })
    expect(anonIns.error).not.toBeNull()
  })

  it('any authenticated diver can read the catalog', async () => {
    const diverSb = await userClient(diver.email, diver.password)
    const { data, error } = await diverSb.from('waivers').select('id, code, title')
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('rejects a waiver with both a body and a pdf_path, or with neither', async () => {
    const both = await admin.from('waivers')
      .insert({ code: `test_wv_${suffix()}`, title: 'Both', body: 'x', pdf_path: 'p/x.pdf' })
    expect(both.error).not.toBeNull()

    const neither = await admin.from('waivers')
      .insert({ code: `test_wv_${suffix()}`, title: 'Neither', body: null, pdf_path: null })
    expect(neither.error).not.toBeNull()
  })

  it('enforces a unique code', async () => {
    const code = `test_wv_${suffix()}`
    const first = await admin.from('waivers').insert({ code, title: 'First', body: 'x' }).select('id').single()
    expect(first.error).toBeNull()
    if (first.data?.id) createdWaiverIds.push(first.data.id)
    const dup = await admin.from('waivers').insert({ code, title: 'Dup', body: 'y' })
    expect(dup.error).not.toBeNull()
  })
})

describe('cancellation_policies RLS + new columns', () => {
  it('an admin can create a policy without supplying an id; a diver cannot', async () => {
    const adminSb = await userClient(adminUser.email, adminUser.password)
    const { data, error } = await adminSb.from('cancellation_policies')
      .insert({ title: 'Test Policy', cancellation_policy: 'No refunds.', language: 'English', active: true })
      .select('id, language, active').single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    expect(data?.language).toBe('English')
    expect(data?.active).toBe(true)
    if (data?.id) createdPolicyIds.push(data.id)

    const diverSb = await userClient(diver.email, diver.password)
    const diverIns = await diverSb.from('cancellation_policies').insert({ title: 'Nope', cancellation_policy: 'x' })
    expect(diverIns.error).not.toBeNull()
  })
})

describe('waiver-pdfs storage RLS', () => {
  const pdfBlob = () => new Blob(['%PDF-1.4 test'], { type: 'application/pdf' })

  it('an admin can upload a PDF; a diver cannot', async () => {
    const adminSb = await userClient(adminUser.email, adminUser.password)
    const path = `w_${suffix()}/waiver.pdf`
    const up = await adminSb.storage.from('waiver-pdfs').upload(path, pdfBlob(), { contentType: 'application/pdf' })
    expect(up.error).toBeNull()
    pdfPaths.push(path)

    const diverSb = await userClient(diver.email, diver.password)
    const diverUp = await diverSb.storage.from('waiver-pdfs').upload(`w_${suffix()}/x.pdf`, pdfBlob(), { contentType: 'application/pdf' })
    expect(diverUp.error).not.toBeNull()
  })

  it('any authenticated diver can read a template, but anon cannot', async () => {
    const adminSb = await userClient(adminUser.email, adminUser.password)
    const path = `w_${suffix()}/waiver.pdf`
    await adminSb.storage.from('waiver-pdfs').upload(path, pdfBlob(), { contentType: 'application/pdf' })
    pdfPaths.push(path)

    const diverSb = await userClient(diver.email, diver.password)
    const diverGet = await diverSb.storage.from('waiver-pdfs').createSignedUrl(path, 60)
    expect(diverGet.error).toBeNull()
    expect(diverGet.data?.signedUrl).toBeTruthy()

    const anonGet = await anonClient().storage.from('waiver-pdfs').createSignedUrl(path, 60)
    expect(anonGet.error).not.toBeNull()
  })
})
