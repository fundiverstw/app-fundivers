/**
 * Constraint tests for the imported catalog tables (EO_courses, EO_dives,
 * EO_prices, EO_rooms, Other_Addons). These aren't touched by the React app
 * yet, but they carry real FK relationships worth exercising.
 *
 * Column names here include spaces and capitals ("Created Date"), hyphens
 * ("link-eo-courses-course_title") and are quoted with double quotes.
 * supabase-js forwards them to PostgREST unchanged.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { adminClient } from './helpers'

const admin = adminClient()
const createdPriceIds: string[] = []
const createdCourseIds: string[] = []
const createdDiveIds: string[] = []

afterEach(async () => {
  if (createdCourseIds.length) await admin.from('EO_courses' as never).delete().in('_id', createdCourseIds)
  if (createdDiveIds.length) await admin.from('EO_dives' as never).delete().in('_id', createdDiveIds)
  if (createdPriceIds.length) await admin.from('EO_prices' as never).delete().in('_id', createdPriceIds)
  createdCourseIds.length = 0
  createdDiveIds.length = 0
  createdPriceIds.length = 0
})

// _id columns are uuid; tests need valid-format ids regardless of which
// table they target.
function rid() {
  return crypto.randomUUID()
}

// Valid uuid format that no row will ever match — used for orphan-FK tests.
const NONEXISTENT_PRICE_ID = '00000000-0000-0000-0000-000000000099'

describe('EO_* catalog table constraints', () => {
  it('EO_prices._id is a primary key (duplicate inserts are rejected)', async () => {
    const id = rid()
    const first = await admin.from('EO_prices' as never).insert({ _id: id, admin_title: 'First' } as never)
    expect(first.error).toBeNull()
    createdPriceIds.push(id)

    const dup = await admin.from('EO_prices' as never).insert({ _id: id, admin_title: 'Dup' } as never)
    expect(dup.error).toBeTruthy()
    expect(String(dup.error?.message ?? '')).toMatch(/duplicate|unique/i)
  })

  it('EO_courses.price → EO_prices._id FK rejects orphan references', async () => {
    const { error } = await admin.from('EO_courses' as never).insert({
      _id: rid(),
      display_title: 'Orphan Course',
      price: NONEXISTENT_PRICE_ID,
    } as never)
    expect(error).toBeTruthy()
    expect(String(error?.message ?? '')).toMatch(/foreign|violat/i)
  })

  it('EO_dives.price → EO_prices._id FK rejects orphan references', async () => {
    const { error } = await admin.from('EO_dives' as never).insert({
      _id: rid(),
      admin_title: 'Orphan Dive',
      notes: '',
      price: NONEXISTENT_PRICE_ID,
    } as never)
    expect(error).toBeTruthy()
  })

  it('EO_dives.price has ON DELETE SET NULL: deleting the price nulls the reference', async () => {
    const priceId = rid()
    await admin.from('EO_prices' as never).insert({ _id: priceId, admin_title: 'P' } as never)
    createdPriceIds.push(priceId)

    const diveId = rid()
    await admin.from('EO_dives' as never).insert({
      _id: diveId, admin_title: 'D', notes: '', price: priceId,
    } as never)
    createdDiveIds.push(diveId)

    // Delete the price — dive.price should become NULL.
    await admin.from('EO_prices' as never).delete().eq('_id', priceId)
    // Remove from cleanup since we already deleted
    createdPriceIds.splice(createdPriceIds.indexOf(priceId), 1)

    const { data } = await admin.from('EO_dives' as never).select('price').eq('_id', diveId).single()
    expect((data as { price: string | null }).price).toBeNull()
  })

  it('EO_courses.price is a plain FK (no cascade): deleting referenced price fails', async () => {
    const priceId = rid()
    await admin.from('EO_prices' as never).insert({ _id: priceId, admin_title: 'P' } as never)
    createdPriceIds.push(priceId)

    const courseId = rid()
    await admin.from('EO_courses' as never).insert({
      _id: courseId, display_title: 'C', price: priceId,
    } as never)
    createdCourseIds.push(courseId)

    const { error } = await admin.from('EO_prices' as never).delete().eq('_id', priceId)
    expect(error).toBeTruthy()
    expect(String(error?.message ?? '')).toMatch(/foreign|violat/i)
  })

  it('EO_courses.course_days accepts up to 4 days and round-trips them', async () => {
    const courseId = rid()
    const days = ['2026-05-09', '2026-05-10', '2026-05-12', '2026-05-16']
    const { error } = await admin.from('EO_courses' as never).insert({
      _id: courseId, display_title: 'Four-day course', course_days: days,
    } as never)
    expect(error).toBeNull()
    createdCourseIds.push(courseId)

    const { data } = await admin.from('EO_courses' as never)
      .select('course_days').eq('_id', courseId).single()
    expect((data as { course_days: string[] }).course_days).toEqual(days)
  })

  it('EO_courses.course_days rejects more than 4 days (CHECK eo_courses_course_days_len)', async () => {
    const { error } = await admin.from('EO_courses' as never).insert({
      _id: rid(),
      display_title: 'Five-day course',
      course_days: ['2026-05-09', '2026-05-10', '2026-05-11', '2026-05-12', '2026-05-13'],
    } as never)
    expect(error).toBeTruthy()
    expect(String(error?.message ?? '')).toMatch(/course_days|violat|check/i)
  })

  it('EO_rooms and Other_Addons have _id primary keys (round-trips cleanly)', async () => {
    const roomId = rid()
    const ins = await admin.from('EO_rooms' as never).insert({
      _id: roomId, admin_title: 'Test Room',
    } as never)
    expect(ins.error).toBeNull()

    const { data } = await admin.from('EO_rooms' as never).select('_id').eq('_id', roomId).single()
    expect((data as { _id: string })._id).toBe(roomId)

    await admin.from('EO_rooms' as never).delete().eq('_id', roomId)

    const addonId = rid()
    const ins2 = await admin.from('Other_Addons' as never).insert({
      _id: addonId, admin_title: 'Test Addon',
    } as never)
    expect(ins2.error).toBeNull()
    await admin.from('Other_Addons' as never).delete().eq('_id', addonId)
  })
})
