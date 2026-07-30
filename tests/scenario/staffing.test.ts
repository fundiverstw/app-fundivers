import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { world, ledger, teardownWorld, type World, type Ledger } from './world'

// Rostering: the shop marks a guide unavailable, tries to put them on a dive
// anyway, and then reshuffles.
//
// Availability and duties are enforced by a trigger, not by the UI, so the thing
// worth walking is the order: busy-then-assign must refuse, assign-then-busy is
// a different question, and clearing the window must actually free the person.

let w: World
const l: Ledger = ledger()

beforeAll(async () => { w = await world(l) })
afterAll(async () => { await teardownWorld(l) })

describe('scenario: a guide marks themselves away', () => {
  it('blocks a duty inside the window and allows one outside it', async () => {
    const guide = await w.person('staff')
    await w.markBusy({ who: guide, fromDays: 10, toDays: 14, title: 'Holiday' })

    const inside = await w.assignDuty({ who: guide, inDays: 12 })
    expect(inside).toMatch(/busy/i)

    const onTheEdge = await w.assignDuty({ who: guide, inDays: 14 })
    expect(onTheEdge).toMatch(/busy/i)

    const after = await w.assignDuty({ who: guide, inDays: 15 })
    expect(after).toBeNull()
  })

  it('frees the guide again once the window is removed', async () => {
    const guide = await w.person('staff')
    const busyId = await w.markBusy({ who: guide, fromDays: 20, toDays: 22 })

    expect(await w.assignDuty({ who: guide, inDays: 21 })).toMatch(/busy/i)

    await w.admin.from('staff_availability').delete().eq('id', busyId)
    expect(await w.assignDuty({ who: guide, inDays: 21 })).toBeNull()
  })

  it('does not block a different person on the same dates', async () => {
    const away = await w.person('staff')
    const available = await w.person('staff')
    await w.markBusy({ who: away, fromDays: 30, toDays: 32 })

    expect(await w.assignDuty({ who: away, inDays: 31 })).toMatch(/busy/i)
    expect(await w.assignDuty({ who: available, inDays: 31 })).toBeNull()
  })
})

describe('scenario: the shop manages a guide\'s availability for them', () => {
  it('an admin records, edits and clears someone else\'s window', async () => {
    const guide = await w.person('staff')
    const db = await w.as(w.adminUser)

    // Record it on the guide's behalf.
    const inserted = await db.from('staff_availability').insert({
      user_id: guide.id,
      start_date: w.dayFromNow(40), start_time: '09:00:00',
      end_date: w.dayFromNow(41), title: 'Course exam',
    } as never).select('id').single()
    expect(inserted.error).toBeNull()
    const id = (inserted.data as { id: string }).id

    expect(await w.assignDuty({ who: guide, inDays: 40 })).toMatch(/busy/i)

    // Extend it, and the block extends with it.
    expect((await db.from('staff_availability')
      .update({ end_date: w.dayFromNow(45) } as never).eq('id', id)).error).toBeNull()
    expect(await w.assignDuty({ who: guide, inDays: 44 })).toMatch(/busy/i)

    // Clear it, and the guide is bookable again.
    expect((await db.from('staff_availability').delete().eq('id', id)).error).toBeNull()
    expect(await w.assignDuty({ who: guide, inDays: 44 })).toBeNull()
  })

  it('a staff member cannot touch a colleague\'s window', async () => {
    const owner = await w.person('staff')
    const other = await w.person('staff')
    const id = await w.markBusy({ who: owner, fromDays: 50, toDays: 51, title: 'Mine' })

    const db = await w.as(other)
    // Both are silent no-ops under RLS rather than errors.
    await db.from('staff_availability').update({ title: 'Hijacked' } as never).eq('id', id)
    await db.from('staff_availability').delete().eq('id', id)

    const { data } = await w.admin.from('staff_availability').select('title').eq('id', id).single()
    expect((data as { title: string }).title).toBe('Mine')
  })

  it('cannot park availability on a diver, whoever asks', async () => {
    const diver = await w.person('diver')
    const db = await w.as(w.adminUser)
    const { error } = await db.from('staff_availability').insert({
      user_id: diver.id,
      start_date: w.dayFromNow(60), start_time: '09:00:00',
      end_date: w.dayFromNow(60), title: 'Should fail',
    } as never)
    expect(error).not.toBeNull()
  })
})
