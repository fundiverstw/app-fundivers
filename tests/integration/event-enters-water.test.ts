// The logistics board's diver / non-diver split is only as good as the column
// behind it, and the failure mode is silent: `enters_water` missing from the
// event read (EVENT_COLS in src/lib/events.ts) falls back to `?? true`, so a
// dry EFR class comes back claiming its students were diving — a confident,
// plausible, wrong answer, and exactly the one the shop's insurer is asking
// about.
//
// Runs the REAL fetch through the app's own client against the live local
// stack, signed in as an admin, so RLS, the column list and the mapping are
// exercised as they are in the browser.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, userClient, createTestUser, deleteTestUser, type TestUser } from './helpers'
import { supabase } from '../../src/lib/supabase'
import { fetchEventsInRange } from '../../src/lib/events'
import { eventEntersWater } from '../../src/lib/participants'

const admin = adminClient()

const DAY = '2031-11-04'

let adminUser: TestUser
let wetDive: string
let dryCourse: string
let wetCourse: string

async function createEvent(row: Record<string, unknown>): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await admin.from('events' as never).insert({ id, ...row } as never)
  if (error) throw new Error(`event insert failed: ${error.message}`)
  return id
}

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  wetDive = await createEvent({
    kind: 'dive', admin_title: 'Water split dive', notes: '',
    start_date: DAY, end_date: DAY, start_time: '08:00:00',
  })
  dryCourse = await createEvent({
    kind: 'course', display_title: 'Water split EFR', start_time: '09:00:00',
    course_days: [DAY], enters_water: false,
  })
  wetCourse = await createEvent({
    kind: 'course', display_title: 'Water split Open Water', start_time: '10:00:00',
    course_days: [DAY],
  })
  await userClient(adminUser.email, adminUser.password)
  const { error } = await supabase.auth.signInWithPassword({
    email: adminUser.email, password: adminUser.password,
  })
  if (error) throw new Error(`admin sign-in failed: ${error.message}`)
})

afterAll(async () => {
  await supabase.auth.signOut()
  for (const id of [wetDive, dryCourse, wetCourse]) {
    if (id) await admin.from('events' as never).delete().eq('id', id)
  }
  if (adminUser) await deleteTestUser(admin, adminUser.id)
})

describe('events.enters_water', () => {
  it('defaults to diving, so no event that already existed changes meaning', async () => {
    const { data } = await admin.from('events' as never)
      .select('enters_water').eq('id', wetDive).single()
    expect((data as { enters_water: boolean }).enters_water).toBe(true)
  })

  it('comes back from the app\'s own event read, per event', async () => {
    const events = await fetchEventsInRange(DAY, DAY, { includePrivate: true })
    const answer = (id: string) => {
      const ev = events.find(e => e.id === id)
      expect(ev, `event ${id} should be in the day's range`).toBeTruthy()
      return eventEntersWater(ev!)
    }
    expect(answer(wetDive)).toBe(true)
    expect(answer(wetCourse)).toBe(true)
    // The whole point: a course whose students never get wet.
    expect(answer(dryCourse)).toBe(false)
  })
})
