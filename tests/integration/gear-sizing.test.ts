// Integration coverage for the gear sizing chart tables (20260706000000).
// Runs against the live local Supabase stack.
//
// RLS contract: staff + admin READ (the logistics fit lookup runs for staff);
// only admins WRITE. Divers see nothing.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient, createTestUser, deleteTestUser, type TestUser,
} from './helpers'

const admin = adminClient()
let diver: TestUser
let staff: TestUser
let adminUser: TestUser
const cleanupModels: string[] = []

async function createModel(name: string): Promise<string> {
  const { data, error } = await admin.from('gear_models')
    .insert({ gear_type: 'wetsuit', name, gender: 'female' } as never).select('id').single()
  if (error) throw new Error(`createModel: ${error.message}`)
  const id = (data as { id: string }).id
  cleanupModels.push(id)
  return id
}

beforeAll(async () => {
  diver = await createTestUser(admin, { role: 'diver' })
  staff = await createTestUser(admin, { role: 'staff' })
  adminUser = await createTestUser(admin, { role: 'admin' })
})

afterAll(async () => {
  for (const id of cleanupModels) await admin.from('gear_models').delete().eq('id', id)
  for (const u of [diver, staff, adminUser]) if (u) await deleteTestUser(admin, u.id)
})

describe('gear sizing charts access', () => {
  it('lets staff read models + sizes so the logistics lookup works', async () => {
    const modelId = await createModel("Women's Saeko")
    const { error: sErr } = await admin.from('gear_model_sizes')
      .insert({ model_id: modelId, label: '5', height_min: 160, height_max: 165, weight_min: 50, weight_max: 57 } as never)
    expect(sErr).toBeNull()

    const staffClient = await userClient(staff.email, staff.password)
    const models = await staffClient.from('gear_models').select('*').eq('id', modelId)
    expect(models.error).toBeNull()
    expect((models.data ?? []).length).toBe(1)

    const sizes = await staffClient.from('gear_model_sizes').select('*').eq('model_id', modelId)
    expect(sizes.error).toBeNull()
    expect((sizes.data ?? []).length).toBe(1)
    expect((sizes.data![0] as { label: string }).label).toBe('5')
  })

  it('hides the charts from divers', async () => {
    await createModel('Hidden model')
    const diverClient = await userClient(diver.email, diver.password)
    const res = await diverClient.from('gear_models').select('*')
    expect(res.data ?? []).toEqual([])
  })

  it('blocks staff from writing (admin-only)', async () => {
    const staffClient = await userClient(staff.email, staff.password)
    const res = await staffClient.from('gear_models')
      .insert({ gear_type: 'bcd', name: 'Staff should not add' } as never)
    expect(res.error).not.toBeNull()
  })

  it('blocks divers from writing', async () => {
    const diverClient = await userClient(diver.email, diver.password)
    const res = await diverClient.from('gear_models')
      .insert({ gear_type: 'fins', name: 'Diver should not add' } as never)
    expect(res.error).not.toBeNull()
  })

  it('replace_gear_model_sizes atomically swaps a model\'s sizes for admins', async () => {
    const modelId = await createModel('Replace Test')
    const seed = await admin.from('gear_model_sizes')
      .insert({ model_id: modelId, label: 'Old', weight_min: 40, weight_max: 50 } as never)
    expect(seed.error).toBeNull()

    const adminClientAuthed = await userClient(adminUser.email, adminUser.password)
    const { error } = await adminClientAuthed.rpc('replace_gear_model_sizes', {
      p_model_id: modelId,
      p_sizes: [
        { label: 'S', weight_min: 50, weight_max: 64 },
        { label: 'M', weight_min: 65, weight_max: 80 },
      ],
    } as never)
    expect(error).toBeNull()

    const rows = await admin.from('gear_model_sizes').select('label').eq('model_id', modelId)
    expect((rows.data ?? []).map(r => (r as { label: string }).label).sort()).toEqual(['M', 'S'])
  })

  it('blocks non-admins from replace_gear_model_sizes', async () => {
    const modelId = await createModel('Replace Guard')
    const staffClient = await userClient(staff.email, staff.password)
    const { error } = await staffClient.rpc('replace_gear_model_sizes', {
      p_model_id: modelId, p_sizes: [{ label: 'X' }],
    } as never)
    expect(error).not.toBeNull()
  })
})
