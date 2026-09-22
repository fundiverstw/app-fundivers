import { describe, it, expect } from 'vitest'
import { dayRoster, eventEntersWater } from './participants'
import type { AppEvent, Booking, Profile } from '../types/database'

const event = (type: AppEvent['type'], enters_water: boolean) =>
  ({ type, enters_water }) as Pick<AppEvent, 'type' | 'enters_water'>

const person = (id: string, name: string, bookingId = `b-${id}`) => ({
  booking: { id: bookingId } as unknown as Booking,
  profile: { id, name } as unknown as Profile,
})

describe('eventEntersWater', () => {
  it('follows the admin answer on the kinds that could go either way', () => {
    expect(eventEntersWater(event('course', true))).toBe(true)
    expect(eventEntersWater(event('course', false))).toBe(false)
    expect(eventEntersWater(event('dive', true))).toBe(true)
    expect(eventEntersWater(event('dive', false))).toBe(false)
  })

  it('keeps an adventure dry whatever the column says', () => {
    // The kind travels overland. A stale true here must not put anyone under.
    expect(eventEntersWater(event('adventure', true))).toBe(false)
  })

  it('treats a missing column as diving, not as dry', () => {
    // An offline snapshot captured before 20260922100000 carries no key; the
    // board must degrade to the answer it gave before, not empty its diver list.
    expect(eventEntersWater({ type: 'dive' } as Pick<AppEvent, 'type' | 'enters_water'>)).toBe(true)
  })
})

describe('dayRoster', () => {
  it('splits the day into who gets in the water and who does not', () => {
    const roster = dayRoster([
      { entersWater: true, rows: [person('p1', 'Ada')] },
      { entersWater: false, rows: [person('p2', 'Bo')] },
    ], '(no profile)')
    expect(roster.map(p => [p.name, p.inWater])).toEqual([['Ada', true], ['Bo', false]])
  })

  it('counts a person once and calls them a diver if any booking dives', () => {
    // Morning EFR class, afternoon fun dive — one body, and they were diving.
    const roster = dayRoster([
      { entersWater: false, rows: [person('p1', 'Ada', 'b-efr')] },
      { entersWater: true, rows: [person('p1', 'Ada', 'b-dive')] },
    ], '(no profile)')
    expect(roster).toHaveLength(1)
    expect(roster[0].inWater).toBe(true)
  })

  it('keys a row with no profile by its booking, so those never merge', () => {
    const orphan = (bookingId: string) => ({ booking: { id: bookingId } as unknown as Booking, profile: null })
    const roster = dayRoster([{ entersWater: true, rows: [orphan('b1'), orphan('b2')] }], '(no profile)')
    expect(roster.map(p => p.key)).toEqual(['b1', 'b2'])
    expect(roster.every(p => p.name === '(no profile)' && p.profileId === null)).toBe(true)
  })

  it('sorts by name so the list reads the same on every reload', () => {
    const roster = dayRoster([{ entersWater: true, rows: [person('p2', 'Zoe'), person('p1', 'Ada')] }], '(no profile)')
    expect(roster.map(p => p.name)).toEqual(['Ada', 'Zoe'])
  })
})
