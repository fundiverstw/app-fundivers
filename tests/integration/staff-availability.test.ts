import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

const admin = adminClient()
let adminUser: TestUser
let staffUser: TestUser
let staffUser2: TestUser
let diverUser: TestUser

beforeAll(async () => {
  adminUser  = await createTestUser(admin, { role: 'admin' })
  staffUser  = await createTestUser(admin, { role: 'staff' })
  staffUser2 = await createTestUser(admin, { role: 'staff' })
  diverUser  = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  for (const u of [adminUser, staffUser, staffUser2, diverUser]) {
    if (u) await deleteTestUser(admin, u.id)
  }
})

describe('staff_availability table', () => {
  it('accepts a minimal row for a staff user (via service role)', async () => {
    const { data, error } = await admin.from('staff_availability').insert({
      user_id: staffUser.id,
      start_date: '2030-02-01',
      start_time: '09:00:00',
      end_date:   '2030-02-03',
      title: 'Vacation',
    }).select().single()
    expect(error).toBeNull()
    expect(data?.title).toBe('Vacation')
    expect(data?.details).toBeNull()
    await admin.from('staff_availability').delete().eq('id', data!.id)
  })

  it('rejects end_date before start_date', async () => {
    const { error } = await admin.from('staff_availability').insert({
      user_id: staffUser.id,
      start_date: '2030-02-10',
      start_time: '09:00:00',
      end_date:   '2030-02-09',
      title: 'Invalid',
    })
    expect(error).not.toBeNull()
    expect(error?.message.toLowerCase()).toMatch(/date/i)
  })

  it('rejects a diver owner via trigger', async () => {
    const { error } = await admin.from('staff_availability').insert({
      user_id: diverUser.id,
      start_date: '2030-02-04',
      start_time: '09:00:00',
      end_date:   '2030-02-04',
      title: 'Should fail',
    })
    expect(error).not.toBeNull()
    expect(error?.message.toLowerCase()).toMatch(/staff|admin/i)
  })

  it('rejects an empty title', async () => {
    const { error } = await admin.from('staff_availability').insert({
      user_id: staffUser.id,
      start_date: '2030-02-04',
      start_time: '09:00:00',
      end_date:   '2030-02-04',
      title: '',
    })
    expect(error).not.toBeNull()
  })
})

describe('staff_availability RLS', () => {
  it('anon cannot select', async () => {
    const anon = anonClient()
    const { data } = await anon.from('staff_availability').select('*').limit(1)
    expect(data ?? []).toEqual([])
  })

  // Row visibility is the privacy boundary, not column masking: a fellow
  // staff member cannot reach the row at all, so there is nothing to mask.
  it('a fellow staff member reading via the view gets no row', async () => {
    const { data: row } = await admin.from('staff_availability').insert({
      user_id: staffUser.id,
      start_date: '2030-02-25', start_time: '09:00:00', end_date: '2030-02-26',
      title: 'Personal-secret',
      details: 'Do not leak',
    }).select().single()
    try {
      const sb = await userClient(staffUser2.email, staffUser2.password)
      const { data: viewed } = await sb.from('staff_availability_view').select('*').eq('id', row!.id)
      expect(viewed ?? []).toEqual([])
    } finally {
      await admin.from('staff_availability').delete().eq('id', row!.id)
    }
  })

  // Admins manage everyone's availability, so they read the content too --
  // an editor that cannot see the title would silently blank it on save.
  it("an admin reading via the view sees another user's title, details and owner name", async () => {
    // A recognizable nickname on the owner proves the profiles join lands.
    await admin.from('profiles').update({ nickname: 'Owner-Ada' }).eq('id', staffUser.id)
    const { data: row } = await admin.from('staff_availability').insert({
      user_id: staffUser.id,
      start_date: '2030-02-25', start_time: '09:00:00', end_date: '2030-02-26',
      title: 'Personal-secret',
      details: 'Visible to admins',
    }).select().single()
    try {
      const sb = await userClient(adminUser.email, adminUser.password)
      const { data: viewed } = await sb.from('staff_availability_view').select('*').eq('id', row!.id).single()
      expect(viewed?.title).toBe('Personal-secret')
      expect(viewed?.details).toBe('Visible to admins')
      expect(viewed?.owner_display_name).toBe('Owner-Ada')
      expect(viewed?.start_date).toBe('2030-02-25')
    } finally {
      await admin.from('staff_availability').delete().eq('id', row!.id)
    }
  })

  it('the owner reading via the view sees their own title + details', async () => {
    const { data: row } = await admin.from('staff_availability').insert({
      user_id: staffUser.id,
      start_date: '2030-02-27', start_time: '09:00:00', end_date: '2030-02-28',
      title: 'My own thing',
      details: 'For my eyes only',
    }).select().single()
    try {
      const sb = await userClient(staffUser.email, staffUser.password)
      const { data: viewed } = await sb.from('staff_availability_view').select('*').eq('id', row!.id).single()
      expect(viewed?.title).toBe('My own thing')
      expect(viewed?.details).toBe('For my eyes only')
    } finally {
      await admin.from('staff_availability').delete().eq('id', row!.id)
    }
  })

  it('a diver sees nothing', async () => {
    // Seed a row so "empty" is meaningful.
    const { data: seeded } = await admin.from('staff_availability').insert({
      user_id: staffUser.id,
      start_date: '2030-02-20', start_time: '09:00:00', end_date: '2030-02-21',
      title: 'For RLS test',
    }).select().single()
    try {
      const sb = await userClient(diverUser.email, diverUser.password)
      const { data } = await sb.from('staff_availability').select('*')
      expect(data ?? []).toEqual([])
    } finally {
      await admin.from('staff_availability').delete().eq('id', seeded!.id)
    }
  })

  it("a staff user sees their own rows but not other staff's", async () => {
    const { data: mine } = await admin.from('staff_availability').insert({
      user_id: staffUser.id,
      start_date: '2030-03-01', start_time: '09:00:00', end_date: '2030-03-02',
      title: 'Mine',
    }).select().single()
    const { data: theirs } = await admin.from('staff_availability').insert({
      user_id: staffUser2.id,
      start_date: '2030-03-01', start_time: '09:00:00', end_date: '2030-03-02',
      title: 'Theirs',
    }).select().single()
    try {
      const sb = await userClient(staffUser.email, staffUser.password)
      const { data } = await sb.from('staff_availability').select('*')
      const ids = (data ?? []).map(r => r.id)
      expect(ids).toContain(mine!.id)
      expect(ids).not.toContain(theirs!.id)
    } finally {
      await admin.from('staff_availability').delete().eq('id', mine!.id)
      await admin.from('staff_availability').delete().eq('id', theirs!.id)
    }
  })

  it('an admin sees every staff_availability row', async () => {
    const { data: a } = await admin.from('staff_availability').insert({
      user_id: staffUser.id,
      start_date: '2030-04-01', start_time: '09:00:00', end_date: '2030-04-02',
      title: 'A',
    }).select().single()
    const { data: b } = await admin.from('staff_availability').insert({
      user_id: staffUser2.id,
      start_date: '2030-04-01', start_time: '09:00:00', end_date: '2030-04-02',
      title: 'B',
    }).select().single()
    try {
      const sb = await userClient(adminUser.email, adminUser.password)
      const { data } = await sb.from('staff_availability').select('*')
      const ids = (data ?? []).map(r => r.id)
      expect(ids).toContain(a!.id)
      expect(ids).toContain(b!.id)
    } finally {
      await admin.from('staff_availability').delete().eq('id', a!.id)
      await admin.from('staff_availability').delete().eq('id', b!.id)
    }
  })

  it('a staff user can only insert their own rows', async () => {
    const sb = await userClient(staffUser.email, staffUser.password)
    const { error: ownErr, data: own } = await sb.from('staff_availability').insert({
      user_id: staffUser.id,
      start_date: '2030-05-01', start_time: '09:00:00', end_date: '2030-05-01',
      title: 'My own',
    }).select().single()
    expect(ownErr).toBeNull()
    if (own) await admin.from('staff_availability').delete().eq('id', own.id)

    const { error: othersErr } = await sb.from('staff_availability').insert({
      user_id: staffUser2.id,
      start_date: '2030-05-01', start_time: '09:00:00', end_date: '2030-05-01',
      title: 'Someone else',
    })
    expect(othersErr).not.toBeNull()
  })

  it('a staff user can only delete their own rows', async () => {
    const { data: others } = await admin.from('staff_availability').insert({
      user_id: staffUser2.id,
      start_date: '2030-06-01', start_time: '09:00:00', end_date: '2030-06-01',
      title: "Other staff's row",
    }).select().single()
    try {
      const sb = await userClient(staffUser.email, staffUser.password)
      const { error } = await sb.from('staff_availability').delete().eq('id', others!.id)
      // Delete on a row that fails the USING predicate is a silent no-op
      // under PostgREST + RLS — error is null but the row remains.
      expect(error).toBeNull()
      const { data: stillThere } = await admin.from('staff_availability').select('id').eq('id', others!.id)
      expect((stillThere ?? []).length).toBe(1)
    } finally {
      await admin.from('staff_availability').delete().eq('id', others!.id)
    }
  })
})

describe('staff_availability admin write policies', () => {
  it('an admin can insert a row for another staff member', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const { data, error } = await sb.from('staff_availability').insert({
      user_id: staffUser.id,
      start_date: '2031-01-05', start_time: '09:00:00', end_date: '2031-01-07',
      title: 'Away (entered by the shop)',
    }).select().single()
    expect(error).toBeNull()
    expect(data?.user_id).toBe(staffUser.id)
    if (data) await admin.from('staff_availability').delete().eq('id', data.id)
  })

  it("an admin can update another staff member's row", async () => {
    const { data: row } = await admin.from('staff_availability').insert({
      user_id: staffUser.id,
      start_date: '2031-02-05', start_time: '09:00:00', end_date: '2031-02-07',
      title: 'Before',
    }).select().single()
    try {
      const sb = await userClient(adminUser.email, adminUser.password)
      const { error } = await sb.from('staff_availability')
        .update({ title: 'After', end_date: '2031-02-09' }).eq('id', row!.id)
      expect(error).toBeNull()
      const { data: after } = await admin.from('staff_availability').select('*').eq('id', row!.id).single()
      expect(after?.title).toBe('After')
      expect(after?.end_date).toBe('2031-02-09')
    } finally {
      await admin.from('staff_availability').delete().eq('id', row!.id)
    }
  })

  it('an admin can reassign a row to a different staff member', async () => {
    const { data: row } = await admin.from('staff_availability').insert({
      user_id: staffUser.id,
      start_date: '2031-03-05', start_time: '09:00:00', end_date: '2031-03-06',
      title: 'Wrong person',
    }).select().single()
    try {
      const sb = await userClient(adminUser.email, adminUser.password)
      const { error } = await sb.from('staff_availability')
        .update({ user_id: staffUser2.id }).eq('id', row!.id)
      expect(error).toBeNull()
      const { data: after } = await admin.from('staff_availability').select('user_id').eq('id', row!.id).single()
      expect(after?.user_id).toBe(staffUser2.id)
    } finally {
      await admin.from('staff_availability').delete().eq('id', row!.id)
    }
  })

  it("an admin can delete another staff member's row", async () => {
    const { data: row } = await admin.from('staff_availability').insert({
      user_id: staffUser.id,
      start_date: '2031-04-05', start_time: '09:00:00', end_date: '2031-04-06',
      title: 'To be removed',
    }).select().single()
    const sb = await userClient(adminUser.email, adminUser.password)
    const { error } = await sb.from('staff_availability').delete().eq('id', row!.id)
    expect(error).toBeNull()
    const { data: remaining } = await admin.from('staff_availability').select('id').eq('id', row!.id)
    expect(remaining ?? []).toEqual([])
  })

  // The owner-role trigger is the backstop the admin policies deliberately
  // lean on: nothing in RLS says the target has to be staff.
  it('an admin still cannot park availability on a diver', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const { error } = await sb.from('staff_availability').insert({
      user_id: diverUser.id,
      start_date: '2031-05-05', start_time: '09:00:00', end_date: '2031-05-06',
      title: 'Should fail',
    })
    expect(error).not.toBeNull()
    expect(error?.message.toLowerCase()).toMatch(/staff|admin/i)
  })

  it('a staff user still cannot update another staff member\'s row', async () => {
    const { data: row } = await admin.from('staff_availability').insert({
      user_id: staffUser2.id,
      start_date: '2031-06-05', start_time: '09:00:00', end_date: '2031-06-06',
      title: 'Not yours',
    }).select().single()
    try {
      const sb = await userClient(staffUser.email, staffUser.password)
      // Failing the USING predicate makes this a silent no-op, not an error.
      await sb.from('staff_availability').update({ title: 'Hijacked' }).eq('id', row!.id)
      const { data: after } = await admin.from('staff_availability').select('title').eq('id', row!.id).single()
      expect(after?.title).toBe('Not yours')
    } finally {
      await admin.from('staff_availability').delete().eq('id', row!.id)
    }
  })
})

describe('duties × staff_availability overlap trigger', () => {
  it('blocks a duty whose start_date falls inside a busy window', async () => {
    const { data: busy } = await admin.from('staff_availability').insert({
      user_id: staffUser.id,
      start_date: '2030-07-01', start_time: '09:00:00', end_date: '2030-07-05',
      title: 'Away',
    }).select().single()
    try {
      const { error } = await admin.from('duties').insert({
        assignee_id: staffUser.id,
        role: 'guide',
        start_date: '2030-07-03',
      })
      expect(error).not.toBeNull()
      expect(error?.message.toLowerCase()).toMatch(/busy/i)
    } finally {
      await admin.from('staff_availability').delete().eq('id', busy!.id)
    }
  })

  it("blocks a duty whose date range straddles a busy window's edge", async () => {
    const { data: busy } = await admin.from('staff_availability').insert({
      user_id: staffUser.id,
      start_date: '2030-08-10', start_time: '09:00:00', end_date: '2030-08-12',
      title: 'Away',
    }).select().single()
    try {
      // duty starts before, ends inside the busy window
      const { error } = await admin.from('duties').insert({
        assignee_id: staffUser.id,
        role: 'guide',
        start_date: '2030-08-08',
        end_date:   '2030-08-11',
      })
      expect(error).not.toBeNull()
    } finally {
      await admin.from('staff_availability').delete().eq('id', busy!.id)
    }
  })

  it('allows a duty entirely outside any busy window', async () => {
    const { data: busy } = await admin.from('staff_availability').insert({
      user_id: staffUser.id,
      start_date: '2030-09-01', start_time: '09:00:00', end_date: '2030-09-03',
      title: 'Away',
    }).select().single()
    try {
      const { data: duty, error } = await admin.from('duties').insert({
        assignee_id: staffUser.id,
        role: 'guide',
        start_date: '2030-09-10',
        end_date:   '2030-09-11',
      }).select().single()
      expect(error).toBeNull()
      if (duty) await admin.from('duties').delete().eq('id', duty.id)
    } finally {
      await admin.from('staff_availability').delete().eq('id', busy!.id)
    }
  })

  it("does not block a duty for a different assignee", async () => {
    const { data: busy } = await admin.from('staff_availability').insert({
      user_id: staffUser.id,
      start_date: '2030-10-01', start_time: '09:00:00', end_date: '2030-10-05',
      title: 'Away',
    }).select().single()
    try {
      const { data: duty, error } = await admin.from('duties').insert({
        assignee_id: adminUser.id,
        role: 'guide',
        start_date: '2030-10-03',
      }).select().single()
      expect(error).toBeNull()
      if (duty) await admin.from('duties').delete().eq('id', duty.id)
    } finally {
      await admin.from('staff_availability').delete().eq('id', busy!.id)
    }
  })
})
