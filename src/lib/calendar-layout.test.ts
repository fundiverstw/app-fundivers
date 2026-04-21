import { describe, it, expect } from 'vitest'
import { assignTracks, segmentsForDay } from './calendar-layout'
import type { AppEvent } from '../types/database'

function mk(id: string, type: AppEvent['type'], start: string, end?: string): AppEvent {
  return {
    id, type, title: id,
    start_time: new Date(`${start}T00:00:00`).toISOString(),
    end_time: end ? new Date(`${end}T00:00:00`).toISOString() : null,
    featured: false, fully_booked: false,
    price: null, deposit_amount: null, currency: 'TWD',
    has_rooms: false, room_type_ids: [],
    has_addons: false, addon_ids: [],
    gear_rental_info: null, nitrox_required: false, dive_days: null,
  }
}

// Re-exported helper so events.test.ts can reuse the shape
export { mk }

describe('assignTracks', () => {
  it('places non-overlapping events on track 0', () => {
    const ranges = assignTracks([
      mk('a', 'dive', '2026-05-01', '2026-05-02'),
      mk('b', 'dive', '2026-05-04', '2026-05-05'),
    ])
    expect(ranges.find(r => r.event.id === 'a')!.track).toBe(0)
    expect(ranges.find(r => r.event.id === 'b')!.track).toBe(0)
  })

  it('stacks overlapping events on higher tracks', () => {
    const ranges = assignTracks([
      mk('a', 'dive',   '2026-05-01', '2026-05-05'),
      mk('b', 'course', '2026-05-03', '2026-05-07'),
      mk('c', 'dive',   '2026-05-04', '2026-05-06'),
    ])
    const tracks = Object.fromEntries(ranges.map(r => [r.event.id, r.track]))
    expect(tracks.a).toBe(0)
    expect(tracks.b).toBe(1)
    expect(tracks.c).toBe(2)
  })

  it('reuses a lower track after the earlier event has ended', () => {
    const ranges = assignTracks([
      mk('a', 'dive',   '2026-05-01', '2026-05-03'),
      mk('b', 'course', '2026-05-02', '2026-05-04'),
      mk('c', 'dive',   '2026-05-05', '2026-05-06'), // starts after a ends
    ])
    const tracks = Object.fromEntries(ranges.map(r => [r.event.id, r.track]))
    expect(tracks.a).toBe(0)
    expect(tracks.b).toBe(1)
    expect(tracks.c).toBe(0)
  })
})

describe('segmentsForDay', () => {
  const ranges = assignTracks([
    mk('multi', 'dive', '2026-05-04', '2026-05-06'), // Mon–Wed
  ])
  // Week containing those dates: Sun 2026-05-03 .. Sat 2026-05-09
  const weekStart = new Date('2026-05-03T00:00:00')
  const weekEnd = new Date('2026-05-09T00:00:00')

  it('marks isStart + showTitle on the event start day', () => {
    const segs = segmentsForDay(new Date('2026-05-04T00:00:00'), ranges, weekStart, weekEnd)
    const seg = segs.get(0)!
    expect(seg.isStart).toBe(true)
    expect(seg.isEnd).toBe(false)
    expect(seg.showTitle).toBe(true)
  })

  it('middle day has neither start nor end, no title', () => {
    const segs = segmentsForDay(new Date('2026-05-05T00:00:00'), ranges, weekStart, weekEnd)
    const seg = segs.get(0)!
    expect(seg.isStart).toBe(false)
    expect(seg.isEnd).toBe(false)
    expect(seg.showTitle).toBe(false)
  })

  it('event end day is marked isEnd', () => {
    const segs = segmentsForDay(new Date('2026-05-06T00:00:00'), ranges, weekStart, weekEnd)
    const seg = segs.get(0)!
    expect(seg.isEnd).toBe(true)
    expect(seg.showTitle).toBe(false)
  })

  it('a week boundary forces a fresh start (rounded left + title reshow)', () => {
    // Event spans Fri 2026-05-01 .. Mon 2026-05-04
    const longRanges = assignTracks([mk('week', 'dive', '2026-05-01', '2026-05-04')])
    const nextWeekStart = new Date('2026-05-03T00:00:00') // Sunday
    const nextWeekEnd = new Date('2026-05-09T00:00:00')
    const segSunday = segmentsForDay(nextWeekStart, longRanges, nextWeekStart, nextWeekEnd).get(0)!
    expect(segSunday.isStart).toBe(true)    // week boundary rounds the left edge
    expect(segSunday.showTitle).toBe(true)  // title re-shown at week start
  })
})
