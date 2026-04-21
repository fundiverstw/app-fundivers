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

function rid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

describe('EO_* catalog table constraints', () => {
  it('EO_prices._id is a primary key (duplicate inserts are rejected)', async () => {
    const id = rid('price')
    const first = await admin.from('EO_prices' as never).insert({ _id: id, title: 'First' } as never)
    expect(first.error).toBeNull()
    createdPriceIds.push(id)

    const dup = await admin.from('EO_prices' as never).insert({ _id: id, title: 'Dup' } as never)
    expect(dup.error).toBeTruthy()
    expect(String(dup.error?.message ?? '')).toMatch(/duplicate|unique/i)
  })

  it('EO_courses.price → EO_prices._id FK rejects orphan references', async () => {
    const { error } = await admin.from('EO_courses' as never).insert({
      _id: rid('course'),
      title: 'Orphan Course',
      price: 'nonexistent-price-id',
    } as never)
    expect(error).toBeTruthy()
    expect(String(error?.message ?? '')).toMatch(/foreign|violat/i)
  })

  it('EO_dives.price → EO_prices._id FK rejects orphan references', async () => {
    const { error } = await admin.from('EO_dives' as never).insert({
      _id: rid('dive'),
      dive_title: 'Orphan Dive',
      notes: '',
      price: 'nonexistent-price-id',
    } as never)
    expect(error).toBeTruthy()
  })

  it('EO_dives.price has ON DELETE SET NULL: deleting the price nulls the reference', async () => {
    const priceId = rid('price')
    await admin.from('EO_prices' as never).insert({ _id: priceId, title: 'P' } as never)
    createdPriceIds.push(priceId)

    const diveId = rid('dive')
    await admin.from('EO_dives' as never).insert({
      _id: diveId, dive_title: 'D', notes: '', price: priceId,
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
    const priceId = rid('price')
    await admin.from('EO_prices' as never).insert({ _id: priceId, title: 'P' } as never)
    createdPriceIds.push(priceId)

    const courseId = rid('course')
    await admin.from('EO_courses' as never).insert({
      _id: courseId, title: 'C', price: priceId,
    } as never)
    createdCourseIds.push(courseId)

    const { error } = await admin.from('EO_prices' as never).delete().eq('_id', priceId)
    expect(error).toBeTruthy()
    expect(String(error?.message ?? '')).toMatch(/foreign|violat/i)
  })

  it('EO_rooms and Other_Addons have _id primary keys (round-trips cleanly)', async () => {
    const roomId = rid('room')
    const ins = await admin.from('EO_rooms' as never).insert({
      _id: roomId, title: 'Test Room',
    } as never)
    expect(ins.error).toBeNull()

    const { data } = await admin.from('EO_rooms' as never).select('_id').eq('_id', roomId).single()
    expect((data as { _id: string })._id).toBe(roomId)

    await admin.from('EO_rooms' as never).delete().eq('_id', roomId)

    const addonId = rid('addon')
    const ins2 = await admin.from('Other_Addons' as never).insert({
      _id: addonId, title: 'Test Addon',
    } as never)
    expect(ins2.error).toBeNull()
    await admin.from('Other_Addons' as never).delete().eq('_id', addonId)
  })
})
