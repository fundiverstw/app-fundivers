import { describe, it, expect } from 'vitest'
import { courseColor, diveOutingFromDestinations, diveIsTripOrBoat } from './event-colors'

describe('courseColor', () => {
  it('buckets Open Water as ow', () => {
    expect(courseColor('Open Water Course')).toBe('ow')
  })

  it('buckets Advanced Open Water as aow (and not ow)', () => {
    expect(courseColor('Advanced Open Water')).toBe('aow')
    expect(courseColor('Advanced Open Water Course')).toBe('aow')
  })

  it('buckets Rescue / EFR / O2 Provider as rescue', () => {
    expect(courseColor('PADI Rescue Course')).toBe('rescue')
    expect(courseColor('EFR Course')).toBe('rescue')
    expect(courseColor('O2 Provider')).toBe('rescue')
    expect(courseColor('Emergency Oxygen Provider')).toBe('rescue')
  })

  it('buckets DSD / Try Dive and Refresher as dsd', () => {
    expect(courseColor('Discover Scuba Diving')).toBe('dsd')
    expect(courseColor('DSD')).toBe('dsd')
    expect(courseColor('Try Dive')).toBe('dsd')
    expect(courseColor('Try Scuba')).toBe('dsd')
    expect(courseColor('Refresher Course')).toBe('dsd')
    expect(courseColor('Scuba Review')).toBe('dsd')
    expect(courseColor('ReActivate')).toBe('dsd')
  })

  it('buckets everything else as specialty', () => {
    expect(courseColor('Deep Specialty')).toBe('specialty')
    expect(courseColor('Nitrox Course')).toBe('specialty')
    expect(courseColor('Equipment Course')).toBe('specialty')
  })

  it('ignores a trailing capacity suffix', () => {
    expect(courseColor('Advanced Open Water (2 spots open)')).toBe('aow')
    expect(courseColor('Open Water Course (fully booked -- register for waitlist)')).toBe('ow')
  })
})

describe('diveOutingFromDestinations', () => {
  it('returns null when no destinations are tagged', () => {
    expect(diveOutingFromDestinations([])).toBeNull()
  })

  it('is local when every destination is a shore-diving site', () => {
    expect(diveOutingFromDestinations([
      { divetype: 'Shore Diving' },
    ])).toBe('local')
  })

  it('is a trip when any destination is a boat dive', () => {
    expect(diveOutingFromDestinations([
      { divetype: 'Boat Diving' },
    ])).toBe('trip')
  })

  it('is a trip when any destination has no divetype set', () => {
    expect(diveOutingFromDestinations([
      { divetype: null },   // e.g. Green Island / Kenting
    ])).toBe('trip')
  })

  it('is a trip if any one of several destinations is not shore diving', () => {
    expect(diveOutingFromDestinations([
      { divetype: 'Shore Diving' },
      { divetype: null },
    ])).toBe('trip')
  })
})

describe('diveIsTripOrBoat', () => {
  it('trusts a tagged trip over the title', () => {
    expect(diveIsTripOrBoat({ title: 'Quiet shore dive', dive_outing: 'trip' })).toBe(true)
  })

  it('trusts a tagged local over the title', () => {
    expect(diveIsTripOrBoat({ title: 'Boat Dives Cathedral', dive_outing: 'local' })).toBe(false)
  })

  it('falls back to the title when no destination is tagged', () => {
    expect(diveIsTripOrBoat({ title: 'Boat Dives Rainbow Reef', dive_outing: null })).toBe(true)
    expect(diveIsTripOrBoat({ title: 'Seven Star in Kenting', dive_outing: undefined })).toBe(true)
    expect(diveIsTripOrBoat({ title: 'Lambai weekend', dive_outing: null })).toBe(true)
    expect(diveIsTripOrBoat({ title: '3 Day Dives at Long Dong Bay', dive_outing: null })).toBe(false)
  })
})
