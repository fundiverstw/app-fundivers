// The next-day gear diff is only as good as the roster it reads. Every size it
// shows comes off `profiles`, so a fetch that returns bookings but loses the
// profile behind them degrades silently into "no size on file" for every sized
// item — a wrong answer that still looks like a real answer.
//
// Runs the REAL fetch (src/lib/logistics-day.ts) through the app's own client
// against the live local stack, signed in as an admin, so RLS, the column list
// and the id join are all exercised as they are in the browser.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, userClient, createTestUser, deleteTestUser, type TestUser } from './helpers'
import { supabase } from '../../src/lib/supabase'
import { fetchDayGearRows } from '../../src/lib/logistics-day'
import { gearDayDiff, gearSizeBreakdown } from '../../src/lib/logistics'

const admin = adminClient()

const DAY = '2031-09-13'
const NEXT_DAY = '2031-09-14'

let adminUser: TestUser
let diverToday: TestUser
let diverNext: TestUser
let courseStudent: TestUser
let eventToday: string
let eventNext: string
let courseNext: string

async function createDive(day: string): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await admin.from('events' as never).insert({
    id,
    kind: 'dive',
    admin_title: `Gear diff ${day}`,
    notes: '',
    start_date: day,
    start_time: '08:00:00',
    end_date: day,
  } as never)
  if (error) throw new Error(`createDive failed: ${error.message}`)
  return id
}

async function createCourse(day: string): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await admin.from('events' as never).insert({
    id,
    kind: 'course',
    display_title: `Gear diff course ${day}`,
    start_time: '09:00:00',
    course_days: [day],
  } as never)
  if (error) throw new Error(`createCourse failed: ${error.message}`)
  return id
}

async function book(userId: string, eventId: string, details: Record<string, unknown>) {
  const { error } = await admin.from('bookings').insert({
    user_id: userId,
    event_id: eventId,
    status: 'confirmed',
    details,
  } as never)
  if (error) throw new Error(`booking insert failed: ${error.message}`)
}

const rents = (items: string[]) => ({ gear: { rent: true, items } })

beforeAll(async () => {
  adminUser  = await createTestUser(admin, { role: 'admin' })
  diverToday = await createTestUser(admin)
  diverNext  = await createTestUser(admin)
  courseStudent = await createTestUser(admin)

  // Sizes live on the profile — the only place the breakdown reads them from.
  // block_self_gear_size_change() rejects the service role (no auth.uid, so
  // is_staff_or_admin() is false), so they go in as the signed-in admin.
  const asAdmin = await userClient(adminUser.email, adminUser.password)
  const sizes = async (id: string, bcd: string, wetsuit: string, fin: string, shoe: string) => {
    const { error } = await asAdmin.from('profiles')
      .update({ bcd_size: bcd, wetsuit_size: wetsuit, fin_size: fin, shoe_size: shoe } as never)
      .eq('id', id)
    if (error) throw new Error(`size update failed: ${error.message}`)
  }
  await sizes(diverToday.id, 'M', 'M', 'M', 'JP 26')
  await sizes(diverNext.id,  'L', 'M', 'M', 'JP 27')
  await sizes(courseStudent.id, 'S', 'S', 'S', 'JP 24')

  eventToday = await createDive(DAY)
  eventNext  = await createDive(NEXT_DAY)
  courseNext = await createCourse(NEXT_DAY)
  const full = ['BCD', 'Wetsuit', 'Fins', 'Boots', 'Regulator']
  await book(diverToday.id, eventToday, rents(full))
  await book(diverNext.id,  eventNext,  rents(full))
  // Course-bundled gear: no item list, the whole set is implied.
  await book(courseStudent.id, courseNext, { gear: { rent: false, included: true } })

  // The page runs as a signed-in admin through the app's module-level client;
  // fetchDayGearRows uses that same client, so sign it in rather than passing
  // a test client it would ignore.
  const { error } = await supabase.auth.signInWithPassword({
    email: adminUser.email, password: adminUser.password,
  })
  if (error) throw new Error(`admin sign-in failed: ${error.message}`)
})

afterAll(async () => {
  await supabase.auth.signOut()
  for (const id of [eventToday, eventNext, courseNext]) {
    if (id) await admin.from('events' as never).delete().eq('id', id)
  }
  for (const u of [adminUser, diverToday, diverNext, courseStudent]) {
    if (u) await deleteTestUser(admin, u.id)
  }
})

describe('fetchDayGearRows', () => {
  it('returns each booking WITH the diver profile that carries the sizes', async () => {
    const rows = await fetchDayGearRows(NEXT_DAY)
    const row = rows.find(r => r.booking.user_id === diverNext.id)
    expect(row, 'the next day\'s booking should come back').toBeTruthy()
    // The regression this file exists for: a row whose profile is null renders
    // as "no size on file" for every sized item, with no error anywhere.
    expect(row!.profile).not.toBeNull()
    expect(row!.profile!.bcd_size).toBe('L')
    expect(row!.profile!.wetsuit_size).toBe('M')
    expect(row!.profile!.fin_size).toBe('M')
    expect(row!.profile!.shoe_size).toBe('JP 27')
  })

  it('feeds a real size breakdown, not an unknown-size bucket', async () => {
    const rows = await fetchDayGearRows(NEXT_DAY)
    for (const [item, size] of [['BCD', 'L'], ['Wetsuit', 'M'], ['Fins', 'M'], ['Boots', 'JP 27']]) {
      const groups = gearSizeBreakdown(rows, item)
      expect(groups.map(g => g.size), `${item} should resolve to ${size}`).toContain(size)
    }
  })

  it('is empty for a day with no events', async () => {
    expect(await fetchDayGearRows('2031-09-20')).toEqual([])
  })

  it('reaches course bookings too — a weekend is dives AND courses', async () => {
    // Courses are selected by `course_days` overlap rather than start_date, and
    // a multi-day course yields one segment per day. If those segments carried
    // anything but the real event id, the booking join would come back empty
    // and every course diver would silently vanish from the diff.
    const rows = await fetchDayGearRows(NEXT_DAY)
    const row = rows.find(r => r.booking.user_id === courseStudent.id)
    expect(row, 'the course student should be in the next day\'s roster').toBeTruthy()
    expect(row!.profile?.bcd_size).toBe('S')
    // Course-included gear packs a full set, so it lands in every sized item.
    expect(gearSizeBreakdown(rows, 'BCD').map(g => g.size)).toContain('S')
  })
})

describe('gearDayDiff over two live days', () => {
  it('carries the matching sizes over and pulls only what differs', async () => {
    const today = await fetchDayGearRows(DAY)
    const next = await fetchDayGearRows(NEXT_DAY)
    const diff = gearDayDiff(today, next)

    // Nothing may land in the unknown-size bucket: both divers are sized.
    expect(diff.lines.filter(l => l.unknownSize)).toEqual([])

    const line = (item: string, size: string | null) =>
      diff.lines.find(l => l.item === item && l.size === size)

    // Same wetsuit and fin size both days — one of each stays on the van.
    expect(line('Wetsuit', 'M')).toMatchObject({ keep: 1, add: 0, free: 0 })
    expect(line('Fins', 'M')).toMatchObject({ keep: 1, add: 0, free: 0 })
    // Regulators are one-size, so they match on count alone: one carries over,
    // and the course student's is the extra to pull.
    expect(line('Regulator', null)).toMatchObject({ keep: 1, add: 1, free: 0 })

    // Different BCD and boot sizes — today's come home, tomorrow's get pulled.
    expect(line('BCD', 'M')).toMatchObject({ keep: 0, add: 0, free: 1 })
    expect(line('BCD', 'L')).toMatchObject({ keep: 0, add: 1, free: 0 })
    expect(line('BCD', 'S')).toMatchObject({ keep: 0, add: 1, free: 0 })
    expect(line('Boots', 'JP 26')).toMatchObject({ free: 1 })
    expect(line('Boots', 'JP 27')).toMatchObject({ add: 1 })
  })
})
