import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

// Pins the parent→child card-folder storage RLS from
// 20260608010000_parent_child_card_storage.sql: a parent can read / write /
// update / delete files under a child's folder ("<child_id>/...") across the
// cert-cards, nitrox-cards, and deep-cards buckets — but only for their OWN
// children, and unrelated divers still can't touch that folder.

const admin = adminClient()
let parent: TestUser
let child: TestUser
let stranger: TestUser

const BUCKETS = ['cert-cards', 'nitrox-cards', 'deep-cards'] as const

async function uploadAs(u: TestUser, bucket: string, path: string, body: string) {
  const sb = await userClient(u.email, u.password)
  return sb.storage.from(bucket).upload(path, new Blob([body], { type: 'text/plain' }), { upsert: true })
}

beforeAll(async () => {
  parent   = await createTestUser(admin, { role: 'diver' })
  child    = await createTestUser(admin, { role: 'diver' })
  stranger = await createTestUser(admin, { role: 'diver' })
  const { error } = await admin
    .from('profiles')
    .update({ parent_account: parent.id } as never)
    .eq('id', child.id)
  if (error) throw error
})

afterAll(async () => {
  for (const uid of [child?.id].filter(Boolean) as string[]) {
    for (const bucket of BUCKETS) {
      const { data } = await admin.storage.from(bucket).list(uid)
      if (data?.length) await admin.storage.from(bucket).remove(data.map(f => `${uid}/${f.name}`))
    }
  }
  if (parent)   await deleteTestUser(admin, parent.id)
  if (child)    await deleteTestUser(admin, child.id)
  if (stranger) await deleteTestUser(admin, stranger.id)
})

describe('parent→child card storage RLS', () => {
  for (const bucket of BUCKETS) {
    it(`${bucket}: parent can upload into their child's folder`, async () => {
      const path = `${child.id}/card-${Date.now()}.txt`
      const { error } = await uploadAs(parent, bucket, path, 'parent-for-child')
      expect(error).toBeNull()
    })

    it(`${bucket}: an unrelated diver cannot upload into the child's folder`, async () => {
      const path = `${child.id}/intruder-${Date.now()}.txt`
      const { error } = await uploadAs(stranger, bucket, path, 'stranger-tried')
      expect(error).not.toBeNull()
    })
  }

  it('cert-cards: parent can read, replace, and delete a child card', async () => {
    const path = `${child.id}/card-${Date.now()}.txt`
    expect((await uploadAs(parent, 'cert-cards', path, 'v1')).error).toBeNull()

    const parentSb = await userClient(parent.email, parent.password)

    // Read (signed URL).
    const signed = await parentSb.storage.from('cert-cards').createSignedUrl(path, 60)
    expect(signed.error).toBeNull()
    expect(signed.data?.signedUrl).toBeTruthy()

    // Replace (update via upsert).
    expect((await uploadAs(parent, 'cert-cards', path, 'v2')).error).toBeNull()

    // Delete.
    const del = await parentSb.storage.from('cert-cards').remove([path])
    expect(del.error).toBeNull()
  })

  it('cert-cards: a stranger cannot read the child card', async () => {
    const path = `${child.id}/card-${Date.now()}.txt`
    expect((await uploadAs(parent, 'cert-cards', path, 'secret')).error).toBeNull()

    const strangerSb = await userClient(stranger.email, stranger.password)
    const signed = await strangerSb.storage.from('cert-cards').createSignedUrl(path, 60)
    expect(signed.error).not.toBeNull()
  })
})
