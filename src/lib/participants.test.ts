import { describe, it, expect } from 'vitest'
import { bookingIsDiver, dayRoster, eventInvolvesScuba, nondiverLabel } from './participants'
import type { AppEvent, Booking, Profile } from '../types/database'

const event = (type: AppEvent['type'], involves_scuba: boolean) =>
  ({ type, involves_scuba }) as Pick<AppEvent, 'type' | 'involves_scuba'>

const person = (id: string, name: string, bookingId = `b-${id}`) => ({
  booking: { id: bookingId } as unknown as Booking,
  profile: { id, name } as unknown as Profile,
})

describe('eventInvolvesScuba', () => {
  it('follows the admin answer on the kinds that could go either way', () => {
    expect(eventInvolvesScuba(event('course', true))).toBe(true)
    expect(eventInvolvesScuba(event('course', false))).toBe(false)
    expect(eventInvolvesScuba(event('dive', true))).toBe(true)
    expect(eventInvolvesScuba(event('dive', false))).toBe(false)
  })

  it('never makes an adventure a scuba event, whatever the column says', () => {
    // The kind travels overland. A stale true here must not put anyone under.
    expect(eventInvolvesScuba(event('adventure', true))).toBe(false)
  })

  it('treats a missing column as scuba, not as no-scuba', () => {
    // An offline snapshot captured before 20260922100000 carries no key; the
    // board must degrade to the answer it gave before, not empty its diver list.
    expect(eventInvolvesScuba({ type: 'dive' } as Pick<AppEvent, 'type' | 'involves_scuba'>)).toBe(true)
  })
})

describe('dayRoster', () => {
  it('splits the day into who scuba dives and who does not', () => {
    const roster = dayRoster([
      { involvesScuba: true, rows: [person('p1', 'Ada')] },
      { involvesScuba: false, rows: [person('p2', 'Bo')] },
    ], '(no profile)')
    expect(roster.map(p => [p.name, p.isDiver])).toEqual([['Ada', true], ['Bo', false]])
  })

  it('counts a person once and calls them a diver if any booking dives', () => {
    // Morning EFR class, afternoon fun dive — one body, and they were diving.
    const roster = dayRoster([
      { involvesScuba: false, rows: [person('p1', 'Ada', 'b-efr')] },
      { involvesScuba: true, rows: [person('p1', 'Ada', 'b-dive')] },
    ], '(no profile)')
    expect(roster).toHaveLength(1)
    expect(roster[0].isDiver).toBe(true)
  })

  it('counts someone on a non-diver option as a non-diver, even on a diving event', () => {
    const snorkeler = {
      booking: { id: 'b-p2', details: { nondiver_option: { id: 'nd1', label: 'Snorkeler' } } } as unknown as Booking,
      profile: { id: 'p2', name: 'Bo' } as unknown as Profile,
    }
    const roster = dayRoster([{ involvesScuba: true, rows: [person('p1', 'Ada'), snorkeler] }], '(no profile)')
    expect(roster.map(p => [p.name, p.isDiver])).toEqual([['Ada', true], ['Bo', false]])
  })

  it('keys a row with no profile by its booking, so those never merge', () => {
    const orphan = (bookingId: string) => ({ booking: { id: bookingId } as unknown as Booking, profile: null })
    const roster = dayRoster([{ involvesScuba: true, rows: [orphan('b1'), orphan('b2')] }], '(no profile)')
    expect(roster.map(p => p.key)).toEqual(['b1', 'b2'])
    expect(roster.every(p => p.name === '(no profile)' && p.profileId === null)).toBe(true)
  })

  it('sorts by name so the list reads the same on every reload', () => {
    const roster = dayRoster([{ involvesScuba: true, rows: [person('p2', 'Zoe'), person('p1', 'Ada')] }], '(no profile)')
    expect(roster.map(p => p.name)).toEqual(['Ada', 'Zoe'])
  })
})

describe('nondiverLabel / bookingIsDiver', () => {
  const diver = { details: {} } as Pick<Booking, 'details'>
  const snorkeler = { details: { nondiver_option: { id: 'nd1', label: 'Snorkeler' } } } as Pick<Booking, 'details'>

  it('names the option, or null for a diver', () => {
    expect(nondiverLabel(snorkeler)).toBe('Snorkeler')
    expect(nondiverLabel(diver)).toBeNull()
    expect(nondiverLabel({ details: null } as unknown as Pick<Booking, 'details'>)).toBeNull()
  })

  it('needs both the event and the booking to say yes', () => {
    expect(bookingIsDiver(event('dive', true), diver)).toBe(true)
    expect(bookingIsDiver(event('dive', true), snorkeler)).toBe(false)
    expect(bookingIsDiver(event('course', false), diver)).toBe(false)
  })
})
