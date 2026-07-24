import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'
import {
  buildRuns, groupIdByEvent, fetchRideGroups, shareRideWith, rideAlone, fetchRidePartnerTitles,
} from './ride-groups'
import { supabase } from './supabase'
import type { EventRideGroup } from '../types/database'

vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }))
const from = supabase.from as unknown as ReturnType<typeof vi.fn>
beforeEach(() => { from.mockReset() })

const row = (eventId: string, groupId: string, day = '2026-07-26'): EventRideGroup => ({
  ride_day: day, event_id: eventId, group_id: groupId, created_at: '', created_by: null,
})

describe('buildRuns', () => {
  it('gives every ungrouped event a run of its own', () => {
    expect(buildRuns(['e1', 'e2'], new Map())).toEqual([
      { key: 'event:e1', eventIds: ['e1'] },
      { key: 'event:e2', eventIds: ['e2'] },
    ])
  })

  it('collapses the members of one group into a single run', () => {
    const groups = groupIdByEvent([row('e1', 'g1'), row('e3', 'g1')])
    expect(buildRuns(['e1', 'e2', 'e3'], groups)).toEqual([
      { key: 'group:g1', eventIds: ['e1', 'e3'] },
      { key: 'event:e2', eventIds: ['e2'] },
    ])
  })

  it('keeps two separate groups separate', () => {
    const groups = groupIdByEvent([row('e1', 'g1'), row('e2', 'g2'), row('e3', 'g1')])
    expect(buildRuns(['e1', 'e2', 'e3'], groups)).toEqual([
      { key: 'group:g1', eventIds: ['e1', 'e3'] },
      { key: 'group:g2', eventIds: ['e2'] },
    ])
  })

  it('is empty for a day with no events', () => {
    expect(buildRuns([], new Map())).toEqual([])
  })
})

describe('fetchRideGroups', () => {
  it('asks for the day and the events shown', async () => {
    const rows = [row('e1', 'g1')]
    const b = mockQueryBuilder({ data: rows })
    const eq = vi.fn(() => b); b.eq = eq
    const inFn = vi.fn(() => b); b.in = inFn
    from.mockReturnValue(b)
    expect(await fetchRideGroups('2026-07-26', ['e1', 'e2'])).toEqual(rows)
    expect(from).toHaveBeenCalledWith('event_ride_groups')
    expect(eq).toHaveBeenCalledWith('ride_day', '2026-07-26')
    expect(inFn).toHaveBeenCalledWith('event_id', ['e1', 'e2'])
  })

  it('skips the round trip with no events', async () => {
    expect(await fetchRideGroups('2026-07-26', [])).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })
})

describe('shareRideWith', () => {
  it('joins the target event\'s existing group, inserting one row', async () => {
    const b = mockQueryBuilder()
    const upsert = vi.fn(() => b); b.upsert = upsert
    from.mockReturnValue(b)
    await shareRideWith({
      day: '2026-07-26', eventId: 'e2', withEventId: 'e1',
      rows: [row('e1', 'g1')], createdBy: 'admin-1',
    })
    expect(upsert).toHaveBeenCalledWith(
      [{ ride_day: '2026-07-26', event_id: 'e2', group_id: 'g1', created_by: 'admin-1' }],
      { onConflict: 'ride_day,event_id' },
    )
  })

  it('starts a new group carrying both events when the target rides alone', async () => {
    const b = mockQueryBuilder()
    const upsert = vi.fn(() => b); b.upsert = upsert
    from.mockReturnValue(b)
    await shareRideWith({
      day: '2026-07-26', eventId: 'e2', withEventId: 'e1', rows: [], createdBy: null,
    })
    const inserted = upsert.mock.calls[0][0] as Array<{ event_id: string; group_id: string }>
    expect(inserted.map(r => r.event_id)).toEqual(['e2', 'e1'])
    // Both land in the same brand-new group.
    expect(new Set(inserted.map(r => r.group_id)).size).toBe(1)
    expect(inserted[0].group_id).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('rideAlone', () => {
  it('deletes the leftover partner too, so a group of one never lingers', async () => {
    const b = mockQueryBuilder()
    const del = vi.fn(() => b); b.delete = del
    const eq = vi.fn(() => b); b.eq = eq
    const inFn = vi.fn(() => b); b.in = inFn
    from.mockReturnValue(b)
    await rideAlone({ day: '2026-07-26', eventId: 'e1', rows: [row('e1', 'g1'), row('e2', 'g1')] })
    expect(del).toHaveBeenCalled()
    expect(eq).toHaveBeenCalledWith('ride_day', '2026-07-26')
    expect(inFn).toHaveBeenCalledWith('event_id', ['e1', 'e2'])
  })

  it('leaves a group of three standing when one member leaves', async () => {
    const b = mockQueryBuilder()
    b.delete = vi.fn(() => b)
    b.eq = vi.fn(() => b)
    const inFn = vi.fn(() => b); b.in = inFn
    from.mockReturnValue(b)
    await rideAlone({
      day: '2026-07-26', eventId: 'e1',
      rows: [row('e1', 'g1'), row('e2', 'g1'), row('e3', 'g1')],
    })
    expect(inFn).toHaveBeenCalledWith('event_id', ['e1'])
  })

  it('does nothing for an event that already rides alone', async () => {
    await rideAlone({ day: '2026-07-26', eventId: 'e9', rows: [row('e1', 'g1')] })
    expect(from).not.toHaveBeenCalled()
  })
})

describe('fetchRidePartnerTitles', () => {
  it('names the other events on the run, preferring the calendar title', async () => {
    const mine = mockQueryBuilder({ data: [{ ride_day: '2026-07-26', group_id: 'g1' }] })
    mine.eq = vi.fn(() => mine)
    const peers = mockQueryBuilder({ data: [
      { event_id: 'e1', ride_day: '2026-07-26', group_id: 'g1' },
      { event_id: 'e2', ride_day: '2026-07-26', group_id: 'g1' },
    ] })
    peers.in = vi.fn(() => peers)
    const events = mockQueryBuilder({ data: [
      { id: 'e2', calendar_title: 'Refresher', display_title: 'Refresher Course', admin_title: 'RF' },
    ] })
    events.in = vi.fn(() => events)
    from.mockReturnValueOnce(mine).mockReturnValueOnce(peers).mockReturnValueOnce(events)
    expect(await fetchRidePartnerTitles('e1')).toEqual(['Refresher'])
  })

  it('returns nothing for an event that travels alone', async () => {
    const mine = mockQueryBuilder({ data: [] })
    mine.eq = vi.fn(() => mine)
    from.mockReturnValue(mine)
    expect(await fetchRidePartnerTitles('e1')).toEqual([])
  })
})
