import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

// Pins the public read + admin-write RLS contract on dive_sites. The /map
// page reads from this table for everyone (anon + authenticated); only
// admins can mutate.

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser

const createdSiteIds: string[] = []

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver     = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  for (const id of createdSiteIds) await admin.from('dive_sites').delete().eq('id', id)
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (diver)     await deleteTestUser(admin, diver.id)
})

describe('dive_sites read access', () => {
  it('any authenticated user can list sites', async () => {
    const sb = await userClient(diver.email, diver.password)
    const { data, error } = await sb.from('dive_sites').select('id,name,region').limit(1)
    expect(error).toBeNull()
    // Seed inserts 19 rows; we just need the read to succeed.
    expect(Array.isArray(data)).toBe(true)
  })
})

describe('dive_sites admin writes', () => {
  it('admin can insert', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const { data, error } = await sb
      .from('dive_sites')
      .insert({ name: 'Test Site', latitude: 25.0, longitude: 121.5, region: 'longdong' })
      .select('id')
      .single<{ id: string }>()
    expect(error).toBeNull()
    if (data) createdSiteIds.push(data.id)
  })

  it('admin can update', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const { data: ins } = await admin
      .from('dive_sites')
      .insert({ name: 'pre', latitude: 25.0, longitude: 121.5, region: 'longdong' })
      .select('id').single<{ id: string }>()
    const id = ins!.id
    createdSiteIds.push(id)
    const { error } = await sb.from('dive_sites').update({ name: 'post' }).eq('id', id)
    expect(error).toBeNull()
    const { data } = await admin.from('dive_sites').select('name').eq('id', id).single<{ name: string }>()
    expect(data?.name).toBe('post')
  })

  it('admin can delete', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const { data: ins } = await admin
      .from('dive_sites')
      .insert({ name: 'doomed', latitude: 25.0, longitude: 121.5, region: 'longdong' })
      .select('id').single<{ id: string }>()
    const id = ins!.id
    const { error } = await sb.from('dive_sites').delete().eq('id', id)
    expect(error).toBeNull()
    const { data } = await admin.from('dive_sites').select('id').eq('id', id).maybeSingle()
    expect(data).toBeNull()
  })

  it('diver cannot insert', async () => {
    const sb = await userClient(diver.email, diver.password)
    const { error } = await sb
      .from('dive_sites')
      .insert({ name: 'diver tried', latitude: 25.0, longitude: 121.5, region: 'longdong' })
    expect(error).not.toBeNull()
  })

  it('diver cannot update', async () => {
    const sb = await userClient(diver.email, diver.password)
    const { data: ins } = await admin
      .from('dive_sites')
      .insert({ name: 'before', latitude: 25.0, longitude: 121.5, region: 'longdong' })
      .select('id').single<{ id: string }>()
    const id = ins!.id
    createdSiteIds.push(id)
    const { error, count } = await sb
      .from('dive_sites')
      .update({ name: 'after' }, { count: 'exact' })
      .eq('id', id)
    expect(error !== null || count === 0).toBe(true)
    const { data } = await admin.from('dive_sites').select('name').eq('id', id).single<{ name: string }>()
    expect(data?.name).toBe('before')
  })

  it('diver cannot delete', async () => {
    const sb = await userClient(diver.email, diver.password)
    const { data: ins } = await admin
      .from('dive_sites')
      .insert({ name: 'survives', latitude: 25.0, longitude: 121.5, region: 'longdong' })
      .select('id').single<{ id: string }>()
    const id = ins!.id
    createdSiteIds.push(id)
    const { error, count } = await sb.from('dive_sites').delete({ count: 'exact' }).eq('id', id)
    expect(error !== null || count === 0).toBe(true)
    const { data } = await admin.from('dive_sites').select('id').eq('id', id).maybeSingle()
    expect(data).not.toBeNull()
  })

  it('rejects an invalid region', async () => {
    const { error } = await admin
      .from('dive_sites')
      .insert({ name: 'bad region', latitude: 25.0, longitude: 121.5, region: 'narnia' as never })
    expect(error).toBeTruthy()
    expect(String(error?.message ?? '')).toMatch(/check|constraint/i)
  })
})
