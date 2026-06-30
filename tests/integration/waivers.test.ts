// Integration coverage for the waiver tables + sign_waiver RPC.
// Runs against the live local Supabase stack.
//
// Contract (20260629000000_waivers.sql):
//   - sign_waiver() server-stamps signed_at = now() and diver_id = auth.uid()
//     (no client-supplied time → nothing to backdate)
//   - a diver reads only their own signatures; staff/admin read all
//   - divers never INSERT signatures directly (only via the RPC)
//   - event_waivers is readable by any authenticated user but writable by
//     admins only
//   - a signature targets at most one event; an event_waivers override targets
//     exactly one (XOR)
//   - deleting the event (or the diver) cascades the rows away
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  createTestDive, createTestCourse, deleteTestDive, deleteTestCourse,
  type TestUser,
} from './helpers'

const admin = adminClient()

let adminUser: TestUser
let staff: TestUser
let diverA: TestUser
let diverB: TestUser
let diveId: string
let courseId: string
const cleanupUsers: string[] = []

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  staff     = await createTestUser(admin, { role: 'staff' })
  diverA    = await createTestUser(admin, { role: 'diver' })
  diverB    = await createTestUser(admin, { role: 'diver' })
  cleanupUsers.push(adminUser.id, staff.id, diverA.id, diverB.id)
  diveId = await createTestDive(admin)
  courseId = await createTestCourse(admin)
})

afterAll(async () => {
  await admin.from('waiver_signatures').delete().in('diver_id', cleanupUsers)
  if (diveId) await deleteTestDive(admin, diveId)
  if (courseId) await deleteTestCourse(admin, courseId)
  for (const id of cleanupUsers) await deleteTestUser(admin, id)
})

describe('sign_waiver RPC', () => {
  it('server-stamps signed_at = now() and diver_id = auth.uid()', async () => {
    const a = await userClient(diverA.email, diverA.password)
    const before = Date.now()
    const { data: id, error } = await a.rpc('sign_waiver', {
      p_code: 'diver_medical', p_version: 1, p_signed_name: '  Diver A  ',
      p_dive_id: null, p_course_id: null,
    })
    expect(error).toBeNull()
    expect(typeof id).toBe('string')

    const { data: row } = await a.from('waiver_signatures').select('*').eq('id', id as string).single()
    const sig = row as { diver_id: string; signed_at: string; signed_name: string }
    expect(sig.diver_id).toBe(diverA.id)        // not client-controllable
    expect(sig.signed_name).toBe('Diver A')     // trimmed server-side
    const stamped = new Date(sig.signed_at).getTime()
    expect(stamped).toBeGreaterThanOrEqual(before - 5_000)
    expect(stamped).toBeLessThanOrEqual(Date.now() + 5_000)
  })

  it('rejects an unauthenticated caller', async () => {
    const anon = (await import('./helpers')).anonClient()
    const { error } = await anon.rpc('sign_waiver', {
      p_code: 'diver_medical', p_version: 1, p_signed_name: 'Nobody',
      p_dive_id: null, p_course_id: null,
    })
    expect(error).not.toBeNull()
  })

  it('rejects a blank signed name', async () => {
    const a = await userClient(diverA.email, diverA.password)
    const { error } = await a.rpc('sign_waiver', {
      p_code: 'diver_medical', p_version: 1, p_signed_name: '   ',
      p_dive_id: null, p_course_id: null,
    })
    expect(error).not.toBeNull()
  })

  it('records a per-event (course) signature', async () => {
    const a = await userClient(diverA.email, diverA.password)
    const { data: id, error } = await a.rpc('sign_waiver', {
      p_code: 'continuing_education', p_version: 1, p_signed_name: 'Diver A',
      p_dive_id: null, p_course_id: courseId,
    })
    expect(error).toBeNull()
    const { data: row } = await a.from('waiver_signatures').select('eo_course_id').eq('id', id as string).single()
    expect((row as { eo_course_id: string }).eo_course_id).toBe(courseId)
  })
})

describe('waiver_signatures RLS', () => {
  it('lets a diver read only their own signatures', async () => {
    const a = await userClient(diverA.email, diverA.password)
    await a.rpc('sign_waiver', { p_code: 'padi_liability', p_version: 1, p_signed_name: 'Diver A', p_dive_id: null, p_course_id: null })

    const b = await userClient(diverB.email, diverB.password)
    const { data: bSeesA } = await b.from('waiver_signatures').select('*').eq('diver_id', diverA.id)
    expect(bSeesA ?? []).toHaveLength(0)

    const { data: aSeesOwn } = await a.from('waiver_signatures').select('*').eq('diver_id', diverA.id)
    expect((aSeesOwn ?? []).length).toBeGreaterThan(0)
  })

  it('lets staff read every diver\'s signatures', async () => {
    const s = await userClient(staff.email, staff.password)
    const { data } = await s.from('waiver_signatures').select('*').eq('diver_id', diverA.id)
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  it('blocks a diver from inserting a signature row directly', async () => {
    const b = await userClient(diverB.email, diverB.password)
    const { error } = await b.from('waiver_signatures').insert({
      diver_id: diverB.id, waiver_code: 'diver_medical', waiver_version: 1, signed_name: 'Sneaky',
    } as never)
    expect(error).not.toBeNull()
  })

  it('rejects a signature that targets two events (at-most-one check)', async () => {
    const { error } = await admin.from('waiver_signatures').insert({
      diver_id: diverA.id, waiver_code: 'continuing_education', waiver_version: 1,
      signed_name: 'Both', eo_dive_id: diveId, eo_course_id: courseId,
    } as never)
    expect(error).not.toBeNull()
  })
})

describe('event_waivers RLS + constraints', () => {
  it('lets an admin set an override and any diver read it', async () => {
    const { error: insErr } = await admin.from('event_waivers').insert({
      eo_course_id: courseId, waiver_code: 'continuing_education', mode: 'exempt', created_by: adminUser.id,
    } as never)
    expect(insErr).toBeNull()

    const b = await userClient(diverB.email, diverB.password)
    const { data } = await b.from('event_waivers').select('*').eq('eo_course_id', courseId)
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  it('blocks a diver from writing an override', async () => {
    const b = await userClient(diverB.email, diverB.password)
    const { error } = await b.from('event_waivers').insert({
      eo_dive_id: diveId, waiver_code: 'padi_liability', mode: 'exempt',
    } as never)
    expect(error).not.toBeNull()
  })

  it('rejects an override that targets neither event (XOR)', async () => {
    const { error } = await admin.from('event_waivers').insert({
      waiver_code: 'padi_liability', mode: 'require', created_by: adminUser.id,
    } as never)
    expect(error).not.toBeNull()
  })

  it('enforces one override per waiver per event', async () => {
    await admin.from('event_waivers').insert({
      eo_dive_id: diveId, waiver_code: 'diver_medical', mode: 'exempt', created_by: adminUser.id,
    } as never)
    const { error } = await admin.from('event_waivers').insert({
      eo_dive_id: diveId, waiver_code: 'diver_medical', mode: 'require', created_by: adminUser.id,
    } as never)
    expect(error).not.toBeNull()
  })
})

describe('cascade on event delete', () => {
  it('removes a course\'s signatures and overrides when the course is deleted', async () => {
    const throwawayCourse = await createTestCourse(admin)
    const a = await userClient(diverA.email, diverA.password)
    await a.rpc('sign_waiver', {
      p_code: 'continuing_education', p_version: 1, p_signed_name: 'Diver A',
      p_dive_id: null, p_course_id: throwawayCourse,
    })
    await admin.from('event_waivers').insert({
      eo_course_id: throwawayCourse, waiver_code: 'continuing_education', mode: 'require', created_by: adminUser.id,
    } as never)

    await deleteTestCourse(admin, throwawayCourse)

    const { data: sigs } = await admin.from('waiver_signatures').select('id').eq('eo_course_id', throwawayCourse)
    expect(sigs ?? []).toHaveLength(0)
    const { data: ovs } = await admin.from('event_waivers').select('id').eq('eo_course_id', throwawayCourse)
    expect(ovs ?? []).toHaveLength(0)
  })
})
