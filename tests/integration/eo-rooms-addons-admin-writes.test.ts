import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

// Pins admin-write RLS contract on EO_rooms + Other_Addons. The
// /admin/rooms and /admin/addons manage pages depend on these policies;
// if they regress, admins can't add catalog rows from the SPA.
// Divers must remain blocked.
//
// Mirrors eo-admin-writes.test.ts.

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser

const createdRoomIds: string[] = []
const createdAddonIds: string[] = []

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver     = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  for (const id of createdRoomIds)  await admin.from('EO_rooms'     as never).delete().eq('_id', id)
  for (const id of createdAddonIds) await admin.from('Other_Addons' as never).delete().eq('_id', id)
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (diver)     await deleteTestUser(admin, diver.id)
})

describe('EO_rooms admin writes', () => {
  it('admin can insert', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    createdRoomIds.push(id)
    const { error } = await sb.from('EO_rooms' as never).insert({
      _id: id, display_title: 'Test Twin', admin_title: 'twin',
    } as never)
    expect(error).toBeNull()
  })

  it('admin can update', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    createdRoomIds.push(id)
    await admin.from('EO_rooms' as never).insert({ _id: id, display_title: 'pre' } as never)
    const { error } = await sb.from('EO_rooms' as never).update({ display_title: 'post' } as never).eq('_id', id)
    expect(error).toBeNull()
    const { data } = await admin.from('EO_rooms' as never).select('display_title').eq('_id', id).single<{ display_title: string }>()
    expect(data?.display_title).toBe('post')
  })

  it('admin can delete', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    await admin.from('EO_rooms' as never).insert({ _id: id, display_title: 'doomed' } as never)
    const { error } = await sb.from('EO_rooms' as never).delete().eq('_id', id)
    expect(error).toBeNull()
    const { data } = await admin.from('EO_rooms' as never).select('_id').eq('_id', id).maybeSingle()
    expect(data).toBeNull()
  })

  it('diver cannot insert', async () => {
    const sb = await userClient(diver.email, diver.password)
    const id = crypto.randomUUID()
    const { error } = await sb.from('EO_rooms' as never).insert({
      _id: id, display_title: 'diver tried',
    } as never)
    expect(error).not.toBeNull()
    const { data } = await admin.from('EO_rooms' as never).select('_id').eq('_id', id).maybeSingle()
    expect(data).toBeNull()
  })

  it('diver cannot update', async () => {
    const sb = await userClient(diver.email, diver.password)
    const id = crypto.randomUUID()
    createdRoomIds.push(id)
    await admin.from('EO_rooms' as never).insert({ _id: id, display_title: 'before' } as never)
    const { error, count } = await sb
      .from('EO_rooms' as never)
      .update({ display_title: 'after' } as never, { count: 'exact' })
      .eq('_id', id)
    expect(error !== null || count === 0).toBe(true)
    const { data } = await admin.from('EO_rooms' as never).select('display_title').eq('_id', id).single<{ display_title: string }>()
    expect(data?.display_title).toBe('before')
  })

  it('diver cannot delete', async () => {
    const sb = await userClient(diver.email, diver.password)
    const id = crypto.randomUUID()
    createdRoomIds.push(id)
    await admin.from('EO_rooms' as never).insert({ _id: id, display_title: 'survives' } as never)
    const { error, count } = await sb.from('EO_rooms' as never).delete({ count: 'exact' }).eq('_id', id)
    expect(error !== null || count === 0).toBe(true)
    const { data } = await admin.from('EO_rooms' as never).select('_id').eq('_id', id).maybeSingle()
    expect(data).not.toBeNull()
  })
})

describe('Other_Addons admin writes', () => {
  it('admin can insert', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    createdAddonIds.push(id)
    const { error } = await sb.from('Other_Addons' as never).insert({
      _id: id, display_title: 'Test SMB', admin_title: 'smb',
    } as never)
    expect(error).toBeNull()
  })

  it('admin can update', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    createdAddonIds.push(id)
    await admin.from('Other_Addons' as never).insert({ _id: id, display_title: 'pre' } as never)
    const { error } = await sb.from('Other_Addons' as never).update({ display_title: 'post' } as never).eq('_id', id)
    expect(error).toBeNull()
    const { data } = await admin.from('Other_Addons' as never).select('display_title').eq('_id', id).single<{ display_title: string }>()
    expect(data?.display_title).toBe('post')
  })

  it('admin can delete', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    await admin.from('Other_Addons' as never).insert({ _id: id, display_title: 'doomed' } as never)
    const { error } = await sb.from('Other_Addons' as never).delete().eq('_id', id)
    expect(error).toBeNull()
    const { data } = await admin.from('Other_Addons' as never).select('_id').eq('_id', id).maybeSingle()
    expect(data).toBeNull()
  })

  it('diver cannot insert', async () => {
    const sb = await userClient(diver.email, diver.password)
    const id = crypto.randomUUID()
    const { error } = await sb.from('Other_Addons' as never).insert({
      _id: id, display_title: 'diver tried',
    } as never)
    expect(error).not.toBeNull()
    const { data } = await admin.from('Other_Addons' as never).select('_id').eq('_id', id).maybeSingle()
    expect(data).toBeNull()
  })

  it('diver cannot update', async () => {
    const sb = await userClient(diver.email, diver.password)
    const id = crypto.randomUUID()
    createdAddonIds.push(id)
    await admin.from('Other_Addons' as never).insert({ _id: id, display_title: 'before' } as never)
    const { error, count } = await sb
      .from('Other_Addons' as never)
      .update({ display_title: 'after' } as never, { count: 'exact' })
      .eq('_id', id)
    expect(error !== null || count === 0).toBe(true)
    const { data } = await admin.from('Other_Addons' as never).select('display_title').eq('_id', id).single<{ display_title: string }>()
    expect(data?.display_title).toBe('before')
  })

  it('diver cannot delete', async () => {
    const sb = await userClient(diver.email, diver.password)
    const id = crypto.randomUUID()
    createdAddonIds.push(id)
    await admin.from('Other_Addons' as never).insert({ _id: id, display_title: 'survives' } as never)
    const { error, count } = await sb.from('Other_Addons' as never).delete({ count: 'exact' }).eq('_id', id)
    expect(error !== null || count === 0).toBe(true)
    const { data } = await admin.from('Other_Addons' as never).select('_id').eq('_id', id).maybeSingle()
    expect(data).not.toBeNull()
  })
})
