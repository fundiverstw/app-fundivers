/**
 * Constraint tests for the catalog tables: the unified events table plus the
 * still-legacy prices, rooms, addons. These exercise the real FK
 * relationships (events.price -> prices.id) and events' own CHECKs.
 *
 * The remaining EO_* tables carry Bubble-legacy column names with spaces and
 * capitals ("Created Date"), hyphens and double-quote quoting. supabase-js
 * forwards them to PostgREST unchanged.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { adminClient } from './helpers'

const admin = adminClient()
const createdPriceIds: string[] = []
const createdEventIds: string[] = []

afterEach(async () => {
  if (createdEventIds.length) await admin.from('events' as never).delete().in('id', createdEventIds)
  if (createdPriceIds.length) await admin.from('prices' as never).delete().in('id', createdPriceIds)
  createdEventIds.length = 0
  createdPriceIds.length = 0
})

// id columns are uuid; tests need valid-format ids regardless of which
// table they target.
function rid() {
  return crypto.randomUUID()
}

// Valid uuid format that no row will ever match — used for orphan-FK tests.
const NONEXISTENT_PRICE_ID = '00000000-0000-0000-0000-000000000099'

describe('catalog table constraints', () => {
  it('prices.id is a primary key (duplicate inserts are rejected)', async () => {
    const id = rid()
    const first = await admin.from('prices' as never).insert({ id: id, admin_title: 'First' } as never)
    expect(first.error).toBeNull()
    createdPriceIds.push(id)

    const dup = await admin.from('prices' as never).insert({ id: id, admin_title: 'Dup' } as never)
    expect(dup.error).toBeTruthy()
    expect(String(dup.error?.message ?? '')).toMatch(/duplicate|unique/i)
  })

  it('events.price → prices.id FK rejects orphan references (course kind)', async () => {
    const { error } = await admin.from('events' as never).insert({
      id: rid(),
      kind: 'course',
      display_title: 'Orphan Course',
      course_days: ['2026-05-09'],
      price: NONEXISTENT_PRICE_ID,
    } as never)
    expect(error).toBeTruthy()
    expect(String(error?.message ?? '')).toMatch(/foreign|violat/i)
  })

  it('events.price → prices.id FK rejects orphan references (dive kind)', async () => {
    const { error } = await admin.from('events' as never).insert({
      id: rid(),
      kind: 'dive',
      admin_title: 'Orphan Dive',
      notes: '',
      start_date: '2026-06-01',
      price: NONEXISTENT_PRICE_ID,
    } as never)
    expect(error).toBeTruthy()
  })

  it('events.price has ON DELETE SET NULL: deleting the price nulls the reference', async () => {
    const priceId = rid()
    await admin.from('prices' as never).insert({ id: priceId, admin_title: 'P' } as never)
    createdPriceIds.push(priceId)

    const eventId = rid()
    await admin.from('events' as never).insert({
      id: eventId, kind: 'dive', admin_title: 'D', notes: '', start_date: '2026-06-01', price: priceId,
    } as never)
    createdEventIds.push(eventId)

    // Delete the price — event.price should become NULL.
    await admin.from('prices' as never).delete().eq('id', priceId)
    // Remove from cleanup since we already deleted
    createdPriceIds.splice(createdPriceIds.indexOf(priceId), 1)

    const { data } = await admin.from('events' as never).select('price').eq('id', eventId).single()
    expect((data as { price: string | null }).price).toBeNull()
  })

  // The old EO_courses.price (plain FK, no cascade → delete blocked) invariant
  // is obsolete: post-unification events.price is uniformly ON DELETE SET NULL
  // for every kind, covered by the SET NULL test above.

  it('events.course_days accepts up to 4 days and round-trips them', async () => {
    const eventId = rid()
    const days = ['2026-05-09', '2026-05-10', '2026-05-12', '2026-05-16']
    const { error } = await admin.from('events' as never).insert({
      id: eventId, kind: 'course', display_title: 'Four-day course', course_days: days,
    } as never)
    expect(error).toBeNull()
    createdEventIds.push(eventId)

    const { data } = await admin.from('events' as never)
      .select('course_days').eq('id', eventId).single()
    expect((data as { course_days: string[] }).course_days).toEqual(days)
  })

  it('events.course_days rejects more than 4 days (CHECK events_course_has_days)', async () => {
    const { error } = await admin.from('events' as never).insert({
      id: rid(),
      kind: 'course',
      display_title: 'Five-day course',
      course_days: ['2026-05-09', '2026-05-10', '2026-05-11', '2026-05-12', '2026-05-13'],
    } as never)
    expect(error).toBeTruthy()
    expect(String(error?.message ?? '')).toMatch(/events_course_has_days|course_days|violat|check/i)
  })

  it('rooms and addons have id primary keys (round-trips cleanly)', async () => {
    const roomId = rid()
    const ins = await admin.from('rooms' as never).insert({
      id: roomId, admin_title: 'Test Room',
    } as never)
    expect(ins.error).toBeNull()

    const { data } = await admin.from('rooms' as never).select('id').eq('id', roomId).single()
    expect((data as { id: string }).id).toBe(roomId)

    await admin.from('rooms' as never).delete().eq('id', roomId)

    const addonId = rid()
    const ins2 = await admin.from('addons' as never).insert({
      id: addonId, admin_title: 'Test Addon',
    } as never)
    expect(ins2.error).toBeNull()
    await admin.from('addons' as never).delete().eq('id', addonId)
  })
})
