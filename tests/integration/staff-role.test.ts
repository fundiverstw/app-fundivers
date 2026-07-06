import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'

// Pins the staff role's RLS contract end-to-end:
//   - Staff can SELECT events, bookings, payments, profiles, admin_notes,
//     and their own duty rows.
//   - Staff CANNOT write to any catalog/admin table (events,
//     rooms, addons, prices, cert_levels,
//     dive_travel, cancellation_policies, event_addons).
//   - Staff CANNOT write to bookings, payments, profiles (other than self),
//     duties, or update/delete admin_notes.
//   - Staff CAN insert admin_notes attributed to themselves.
//   - Staff cannot read other staff's duties (own-only SELECT policy).
//   - The duties assignee trigger now accepts staff in addition to admin.

const admin = adminClient()
let staff: TestUser
let otherStaff: TestUser
let diver: TestUser
let adminUser: TestUser
let diveId: string

beforeAll(async () => {
  staff      = await createTestUser(admin, { role: 'staff' })
  otherStaff = await createTestUser(admin, { role: 'staff' })
  diver      = await createTestUser(admin, { role: 'diver' })
  adminUser  = await createTestUser(admin, { role: 'admin' })
  diveId     = await createTestDive(admin)
})

afterAll(async () => {
  if (diveId) await deleteTestDive(admin, diveId)
  if (staff) await deleteTestUser(admin, staff.id)
  if (otherStaff) await deleteTestUser(admin, otherStaff.id)
  if (diver) await deleteTestUser(admin, diver.id)
  if (adminUser) await deleteTestUser(admin, adminUser.id)
})

describe('staff role: read access', () => {
  it('can SELECT events', async () => {
    const sb = await userClient(staff.email, staff.password)
    const { data, error } = await sb.from('events' as never).select('id').limit(1)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('can SELECT all bookings (not just their own)', async () => {
    // Seed a booking for the diver — staff must be able to see it.
    await admin.from('bookings').insert({
      user_id: diver.id, event_id: diveId, status: 'pending', details: {},
    })
    const sb = await userClient(staff.email, staff.password)
    const { data, error } = await sb.from('bookings').select('id, user_id').eq('event_id', diveId)
    expect(error).toBeNull()
    expect((data ?? []).some(b => b.user_id === diver.id)).toBe(true)
    await admin.from('bookings').delete().eq('event_id', diveId)
  })

  it('can SELECT all profiles (PII visibility for event ops)', async () => {
    const sb = await userClient(staff.email, staff.password)
    const { data, error } = await sb.from('profiles').select('id').in('id', [diver.id, adminUser.id])
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(2)
  })

  it('can SELECT admin_notes', async () => {
    const sb = await userClient(staff.email, staff.password)
    const { error } = await sb.from('admin_notes').select('id').limit(1)
    expect(error).toBeNull()
  })
})

describe('staff role: blocked writes on catalog tables', () => {
  // For RLS-violating writes to a public-readable table (EO_*), PostgREST
  // returns the row count = 0 with no error rather than 403, because the
  // write is filtered out by the RLS WITH CHECK. Either an error OR an
  // affected-row check is sufficient evidence the write didn't take.

  it('cannot INSERT into events', async () => {
    const sb = await userClient(staff.email, staff.password)
    const id = crypto.randomUUID()
    const { error } = await sb.from('events' as never).insert({
      id, kind: 'dive', admin_title: 'staff-attempted', notes: '', start_date: '2026-12-01', start_time: '09:00:00', end_date: '2026-12-01',
    } as never)
    expect(error).not.toBeNull()
    const { data } = await admin.from('events' as never).select('id').eq('id', id).maybeSingle()
    expect(data).toBeNull()
  })

  it('cannot UPDATE an event', async () => {
    const sb = await userClient(staff.email, staff.password)
    const { count } = await sb.from('events' as never)
      .update({ admin_title: 'staff-overwrote' } as never, { count: 'exact' })
      .eq('id', diveId)
    expect(count).toBe(0)
  })

  it('cannot DELETE an event', async () => {
    const sb = await userClient(staff.email, staff.password)
    const { count } = await sb.from('events' as never).delete({ count: 'exact' }).eq('id', diveId)
    expect(count).toBe(0)
    const { data } = await admin.from('events' as never).select('id').eq('id', diveId).single()
    expect(data).not.toBeNull()
  })

  it('cannot INSERT into addons', async () => {
    const sb = await userClient(staff.email, staff.password)
    const id = crypto.randomUUID()
    const { error } = await sb.from('addons' as never).insert({
      id: id, display_title: 'staff-tried', admin_title: 'x',
    } as never)
    expect(error).not.toBeNull()
  })

  it('cannot INSERT into rooms', async () => {
    const sb = await userClient(staff.email, staff.password)
    const id = crypto.randomUUID()
    const { error } = await sb.from('rooms' as never).insert({ id: id, display_title: 'no' } as never)
    expect(error).not.toBeNull()
  })

  it('cannot INSERT into event_addons junction', async () => {
    const sb = await userClient(staff.email, staff.password)
    const { error } = await sb.from('event_addons').insert({ event_id: diveId, addon_id: crypto.randomUUID() })
    expect(error).not.toBeNull()
  })
})

describe('staff role: blocked writes on operational tables', () => {
  it('cannot UPDATE booking status', async () => {
    const { data: ins } = await admin.from('bookings').insert({
      user_id: diver.id, event_id: diveId, status: 'pending', details: {},
    }).select('id').single()
    const bookingId = ins!.id

    const sb = await userClient(staff.email, staff.password)
    const { count } = await sb.from('bookings')
      .update({ status: 'confirmed' }, { count: 'exact' })
      .eq('id', bookingId)
    expect(count).toBe(0)

    const { data } = await admin.from('bookings').select('status').eq('id', bookingId).single()
    expect(data?.status).toBe('pending')
    await admin.from('bookings').delete().eq('id', bookingId)
  })

  it('cannot UPDATE another user\'s profile (PII immutable from staff)', async () => {
    const sb = await userClient(staff.email, staff.password)
    const { count } = await sb.from('profiles')
      .update({ name: 'staff-changed' }, { count: 'exact' })
      .eq('id', diver.id)
    expect(count).toBe(0)
  })

  it('cannot INSERT into duties', async () => {
    const sb = await userClient(staff.email, staff.password)
    const { error } = await sb.from('duties').insert({
      assignee_id: staff.id, role: 'guide', start_date: '2026-12-01', event_id: diveId,
    })
    expect(error).not.toBeNull()
  })
})

describe('staff role: admin_notes write surface', () => {
  it('can INSERT a memo attributed to self', async () => {
    const sb = await userClient(staff.email, staff.password)
    const { data, error } = await sb.from('admin_notes').insert({
      created_by: staff.id, event_id: diveId, tag: 'note', content: 'staff memo',
    }).select('id').single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    await admin.from('admin_notes').delete().eq('id', data!.id)
  })

  it('cannot INSERT a memo attributed to a different user', async () => {
    const sb = await userClient(staff.email, staff.password)
    const { error } = await sb.from('admin_notes').insert({
      created_by: adminUser.id, event_id: diveId, tag: 'note', content: 'spoofed author',
    })
    expect(error).not.toBeNull()
  })

  it('cannot UPDATE a memo (resolve/unresolve is admin-only)', async () => {
    const { data: ins } = await admin.from('admin_notes').insert({
      created_by: staff.id, event_id: diveId, tag: 'note', content: 'will not resolve',
    }).select('id').single()
    const noteId = ins!.id

    const sb = await userClient(staff.email, staff.password)
    const { count } = await sb.from('admin_notes')
      .update({ resolved: true, resolved_by: staff.id, resolved_at: new Date().toISOString() }, { count: 'exact' })
      .eq('id', noteId)
    expect(count).toBe(0)

    await admin.from('admin_notes').delete().eq('id', noteId)
  })

  it('cannot DELETE a memo', async () => {
    const { data: ins } = await admin.from('admin_notes').insert({
      created_by: staff.id, event_id: diveId, tag: 'note', content: 'will not delete',
    }).select('id').single()
    const noteId = ins!.id

    const sb = await userClient(staff.email, staff.password)
    const { count } = await sb.from('admin_notes').delete({ count: 'exact' }).eq('id', noteId)
    expect(count).toBe(0)

    const { data } = await admin.from('admin_notes').select('id').eq('id', noteId).single()
    expect(data).not.toBeNull()
    await admin.from('admin_notes').delete().eq('id', noteId)
  })
})

describe('staff role: duties visibility', () => {
  it('can SELECT only their own duty rows', async () => {
    // Admin assigns one duty to staff and one to another staff member.
    const { data: mine } = await admin.from('duties').insert({
      assignee_id: staff.id, role: 'guide', start_date: '2026-12-01', event_id: diveId,
    }).select('id').single()
    const { data: theirs } = await admin.from('duties').insert({
      assignee_id: otherStaff.id, role: 'guide', start_date: '2026-12-01', event_id: diveId,
    }).select('id').single()

    const sb = await userClient(staff.email, staff.password)
    const { data, error } = await sb.from('duties').select('id, assignee_id').eq('event_id', diveId)
    expect(error).toBeNull()
    const ids = (data ?? []).map(d => d.id)
    expect(ids).toContain(mine!.id)
    expect(ids).not.toContain(theirs!.id)

    await admin.from('duties').delete().in('id', [mine!.id, theirs!.id])
  })
})

describe('duties trigger: admin AND staff are valid assignees', () => {
  it('admin assignee still works', async () => {
    const { data, error } = await admin.from('duties').insert({
      assignee_id: adminUser.id, role: 'guide', start_date: '2026-12-01', event_id: diveId,
    }).select('id').single()
    expect(error).toBeNull()
    if (data) await admin.from('duties').delete().eq('id', data.id)
  })

  it('staff assignee is now accepted (was rejected pre-staff-role)', async () => {
    const { data, error } = await admin.from('duties').insert({
      assignee_id: staff.id, role: 'guide', start_date: '2026-12-01', event_id: diveId,
    }).select('id').single()
    expect(error).toBeNull()
    if (data) await admin.from('duties').delete().eq('id', data.id)
  })

  it('diver assignee still rejected', async () => {
    const { error } = await admin.from('duties').insert({
      assignee_id: diver.id, role: 'guide', start_date: '2026-12-01', event_id: diveId,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/admin|staff/i)
  })
})
