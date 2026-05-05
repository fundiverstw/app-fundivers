import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

// Pins the public read + admin-write RLS contract on cert_levels. Anyone
// (anon or authenticated) can list certifications because the Wix
// detail page + PWA register page both read them; only admins mutate.

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser

const createdIds: string[] = []

function uniqCode() {
  return `test_${Math.random().toString(36).slice(2, 10)}`
}

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver     = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  for (const id of createdIds) await admin.from('cert_levels').delete().eq('id', id)
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (diver)     await deleteTestUser(admin, diver.id)
})

describe('cert_levels read access', () => {
  it('anyone authenticated can list cert levels', async () => {
    const sb = await userClient(diver.email, diver.password)
    const { data, error } = await sb
      .from('cert_levels')
      .select('id,code,name,rank')
      .order('rank')
    expect(error).toBeNull()
    // Migration seeds 5 standard levels (open_water → instructor).
    expect((data ?? []).length).toBeGreaterThanOrEqual(5)
  })
})

describe('cert_levels admin writes', () => {
  it('admin can insert', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const { data, error } = await sb
      .from('cert_levels')
      .insert({ code: uniqCode(), name: 'Test cert', rank: 99, organization: 'TEST' })
      .select('id').single<{ id: string }>()
    expect(error).toBeNull()
    if (data) createdIds.push(data.id)
  })

  it('admin can update', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const { data: ins } = await admin
      .from('cert_levels')
      .insert({ code: uniqCode(), name: 'pre', rank: 100, organization: 'TEST' })
      .select('id').single<{ id: string }>()
    const id = ins!.id
    createdIds.push(id)
    const { error } = await sb.from('cert_levels').update({ name: 'post' }).eq('id', id)
    expect(error).toBeNull()
    const { data } = await admin
      .from('cert_levels').select('name').eq('id', id).single<{ name: string }>()
    expect(data?.name).toBe('post')
  })

  it('admin can delete', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const { data: ins } = await admin
      .from('cert_levels')
      .insert({ code: uniqCode(), name: 'doomed', rank: 101, organization: 'TEST' })
      .select('id').single<{ id: string }>()
    const id = ins!.id
    const { error } = await sb.from('cert_levels').delete().eq('id', id)
    expect(error).toBeNull()
    const { data } = await admin.from('cert_levels').select('id').eq('id', id).maybeSingle()
    expect(data).toBeNull()
  })

  it('diver cannot insert', async () => {
    const sb = await userClient(diver.email, diver.password)
    const { error } = await sb
      .from('cert_levels')
      .insert({ code: uniqCode(), name: 'diver tried', rank: 102, organization: 'TEST' })
    expect(error).not.toBeNull()
  })

  it('diver cannot update', async () => {
    const sb = await userClient(diver.email, diver.password)
    const { data: ins } = await admin
      .from('cert_levels')
      .insert({ code: uniqCode(), name: 'before', rank: 103, organization: 'TEST' })
      .select('id').single<{ id: string }>()
    const id = ins!.id
    createdIds.push(id)
    const { error, count } = await sb
      .from('cert_levels')
      .update({ name: 'after' }, { count: 'exact' })
      .eq('id', id)
    expect(error !== null || count === 0).toBe(true)
    const { data } = await admin
      .from('cert_levels').select('name').eq('id', id).single<{ name: string }>()
    expect(data?.name).toBe('before')
  })

  it('diver cannot delete', async () => {
    const sb = await userClient(diver.email, diver.password)
    const { data: ins } = await admin
      .from('cert_levels')
      .insert({ code: uniqCode(), name: 'survives', rank: 104, organization: 'TEST' })
      .select('id').single<{ id: string }>()
    const id = ins!.id
    createdIds.push(id)
    const { error, count } = await sb.from('cert_levels').delete({ count: 'exact' }).eq('id', id)
    expect(error !== null || count === 0).toBe(true)
    const { data } = await admin.from('cert_levels').select('id').eq('id', id).maybeSingle()
    expect(data).not.toBeNull()
  })

  it('rejects duplicate rank', async () => {
    const code1 = uniqCode()
    const { data: a } = await admin
      .from('cert_levels')
      .insert({ code: code1, name: 'first', rank: 200, organization: 'TEST' })
      .select('id').single<{ id: string }>()
    if (a) createdIds.push(a.id)
    const { error } = await admin
      .from('cert_levels')
      .insert({ code: uniqCode(), name: 'second', rank: 200, organization: 'TEST' })
    expect(error).toBeTruthy()
    expect(String(error?.message ?? '')).toMatch(/duplicate|unique/i)
  })

  it('rejects non-positive rank', async () => {
    const { error } = await admin
      .from('cert_levels')
      .insert({ code: uniqCode(), name: 'zero', rank: 0, organization: 'TEST' })
    expect(error).toBeTruthy()
    expect(String(error?.message ?? '')).toMatch(/check|constraint/i)
  })
})
