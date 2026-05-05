import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

// Pins the admin-write RLS contract on EO_prices. The /admin/new "+ New
// price tier" sub-form depends on these policies; if they regress, admins
// can't create new tiers from the SPA. Divers must remain blocked.

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser

const createdPriceIds: string[] = []

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver     = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  for (const id of createdPriceIds) await admin.from('EO_prices' as never).delete().eq('_id', id)
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (diver)     await deleteTestUser(admin, diver.id)
})

describe('EO_prices admin writes', () => {
  it('admin can insert', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    createdPriceIds.push(id)
    const { error } = await sb.from('EO_prices' as never).insert({
      _id: id, admin_title: 'Admin tier', starting_at: 5000,
    } as never)
    expect(error).toBeNull()
  })

  it('admin can update', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    createdPriceIds.push(id)
    await admin.from('EO_prices' as never).insert({ _id: id, admin_title: 'pre' } as never)
    const { error } = await sb.from('EO_prices' as never).update({ admin_title: 'post' } as never).eq('_id', id)
    expect(error).toBeNull()
    const { data } = await admin
      .from('EO_prices' as never).select("admin_title").eq('_id', id).single<{ admin_title: string }>()
    expect(data?.admin_title).toBe('post')
  })

  it('admin can delete', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    await admin.from('EO_prices' as never).insert({ _id: id, admin_title: 'doomed' } as never)
    const { error } = await sb.from('EO_prices' as never).delete().eq('_id', id)
    expect(error).toBeNull()
    const { data } = await admin.from('EO_prices' as never).select('_id').eq('_id', id).maybeSingle()
    expect(data).toBeNull()
  })

  it('diver cannot insert', async () => {
    const sb = await userClient(diver.email, diver.password)
    const id = crypto.randomUUID()
    const { error } = await sb.from('EO_prices' as never).insert({
      _id: id, admin_title: 'diver tried',
    } as never)
    expect(error).not.toBeNull()
    const { data } = await admin.from('EO_prices' as never).select('_id').eq('_id', id).maybeSingle()
    expect(data).toBeNull()
  })

  it('diver cannot update', async () => {
    const sb = await userClient(diver.email, diver.password)
    const id = crypto.randomUUID()
    createdPriceIds.push(id)
    await admin.from('EO_prices' as never).insert({ _id: id, admin_title: 'before' } as never)
    const { error, count } = await sb
      .from('EO_prices' as never)
      .update({ admin_title: 'after' } as never, { count: 'exact' })
      .eq('_id', id)
    expect(error !== null || count === 0).toBe(true)
    const { data } = await admin
      .from('EO_prices' as never).select("admin_title").eq('_id', id).single<{ admin_title: string }>()
    expect(data?.admin_title).toBe('before')
  })

  it('diver cannot delete', async () => {
    const sb = await userClient(diver.email, diver.password)
    const id = crypto.randomUUID()
    createdPriceIds.push(id)
    await admin.from('EO_prices' as never).insert({ _id: id, admin_title: 'survives' } as never)
    const { error, count } = await sb.from('EO_prices' as never).delete({ count: 'exact' }).eq('_id', id)
    expect(error !== null || count === 0).toBe(true)
    const { data } = await admin.from('EO_prices' as never).select('_id').eq('_id', id).maybeSingle()
    expect(data).not.toBeNull()
  })
})
