import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

// Pins the storage RLS on the cert-cards private bucket. The policies we
// wrote in 20260422200000_profile_cert_card.sql:
//   - each user can read / write / update / delete files under
//     "<their_user_id>/..."
//   - admins can additionally read any file
// Anyone else (anon, or authenticated-but-not-owner-and-not-admin) is
// denied. These tests exercise both the positive and negative cases.

const admin = adminClient()
let alice: TestUser
let bob: TestUser
let adminUser: TestUser

const aliceFileName = () => `${alice.id}/cert-${Date.now()}.txt`

async function uploadAs(userEmail: string, userPassword: string, path: string, body: string) {
  const sb = await userClient(userEmail, userPassword)
  return sb.storage.from('cert-cards').upload(path, new Blob([body], { type: 'text/plain' }), { upsert: true })
}

beforeAll(async () => {
  alice     = await createTestUser(admin, { role: 'diver' })
  bob       = await createTestUser(admin, { role: 'diver' })
  adminUser = await createTestUser(admin, { role: 'admin' })
})

afterAll(async () => {
  // Best-effort: clean up any files under the test users' folders so the
  // local bucket doesn't accumulate across runs. Uses service role, bypasses RLS.
  for (const uid of [alice?.id, bob?.id].filter(Boolean) as string[]) {
    const { data } = await admin.storage.from('cert-cards').list(uid)
    if (data?.length) {
      await admin.storage.from('cert-cards').remove(data.map(f => `${uid}/${f.name}`))
    }
  }
  if (alice)     await deleteTestUser(admin, alice.id)
  if (bob)       await deleteTestUser(admin, bob.id)
  if (adminUser) await deleteTestUser(admin, adminUser.id)
})

describe('cert-cards storage RLS', () => {
  it('a diver can upload a file under their own folder', async () => {
    const path = aliceFileName()
    const { error } = await uploadAs(alice.email, alice.password, path, 'alice-cert')
    expect(error).toBeNull()
  })

  it('a diver cannot upload into another diver\'s folder', async () => {
    const path = `${alice.id}/stolen-${Date.now()}.txt`
    const { error } = await uploadAs(bob.email, bob.password, path, 'bob-tried-alice')
    expect(error).not.toBeNull()
  })

  it('a diver can read their own file but not another diver\'s', async () => {
    const alicePath = aliceFileName()
    await uploadAs(alice.email, alice.password, alicePath, 'alice-cert')

    const aliceSb = await userClient(alice.email, alice.password)
    const bobSb   = await userClient(bob.email, bob.password)

    const aliceGet = await aliceSb.storage.from('cert-cards').createSignedUrl(alicePath, 60)
    expect(aliceGet.error).toBeNull()
    expect(aliceGet.data?.signedUrl).toBeTruthy()

    const bobGet = await bobSb.storage.from('cert-cards').createSignedUrl(alicePath, 60)
    expect(bobGet.error).not.toBeNull()
  })

  it('an admin can read any diver\'s file via signed URL', async () => {
    const alicePath = aliceFileName()
    await uploadAs(alice.email, alice.password, alicePath, 'alice-cert')

    const adminSb = await userClient(adminUser.email, adminUser.password)
    const { data, error } = await adminSb.storage.from('cert-cards').createSignedUrl(alicePath, 60)
    expect(error).toBeNull()
    expect(data?.signedUrl).toBeTruthy()
  })

  it('anon cannot read files in the private bucket', async () => {
    const alicePath = aliceFileName()
    await uploadAs(alice.email, alice.password, alicePath, 'alice-cert')

    const { error } = await anonClient().storage.from('cert-cards').createSignedUrl(alicePath, 60)
    expect(error).not.toBeNull()
  })

  it('a diver cannot delete another diver\'s file', async () => {
    const alicePath = aliceFileName()
    await uploadAs(alice.email, alice.password, alicePath, 'alice-cert')

    const bobSb = await userClient(bob.email, bob.password)
    await bobSb.storage.from('cert-cards').remove([alicePath])

    // Verify the file is still there — a service-role list should see it.
    const { data } = await admin.storage.from('cert-cards').list(alice.id)
    const stillThere = (data ?? []).some(f => `${alice.id}/${f.name}` === alicePath)
    expect(stillThere).toBe(true)
  })
})
