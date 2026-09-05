import { describe, it, expect } from 'vitest'
import { blankForm, emptyForm, formStateFrom, parseWildlife, submitArgs } from './almanac-form'
import { todayIso } from './dates'
import type { AlmanacOwnRecord } from '../types/database'

const record = (over: Partial<AlmanacOwnRecord> = {}): AlmanacOwnRecord => ({
  id: 'rec-1',
  created_at: '2026-08-02T00:00:00Z',
  updated_at: '2026-08-02T00:00:00Z',
  diver_id: 'diver-1',
  site_id: 'site-1',
  obs_date: '2026-08-01',
  air_temp_c: 30,
  water_temp_c: 26.5,
  visibility_m: 12,
  current_strength: 'light',
  wave_height_m: 0.5,
  wave_period_s: 8,
  weather: 'clear',
  wildlife: ['turtle', 'manta'],
  coral_health: 'good',
  elevation_m: null,
  route_condition: null,
  summit_visible: null,
  trash_band: 'noticeable',
  trash_count: null,
  trash_kinds: ['plastic'],
  status: 'pending',
  approved_by: null,
  approved_at: null,
  staff_notes: null,
  ...over,
})

describe('a blank form', () => {
  it('opens on today, because that is when the diver was in the water', () => {
    expect(blankForm().obs_date).toBe(todayIso())
  })

  it('leaves every reading unanswered rather than guessing a default', () => {
    expect(emptyForm.air_temp_c).toBe('')
    expect(emptyForm.current_strength).toBe('')
    expect(emptyForm.trash_band).toBe('')
    expect(emptyForm.trash_kinds).toEqual([])
  })
})

describe('opening a filed record for correction', () => {
  it('puts every reading back in the box it was typed into', () => {
    const form = formStateFrom(record(), 'dive')
    expect(form).toMatchObject({
      site_id: 'site-1',
      obs_date: '2026-08-01',
      air_temp_c: '30',
      water_temp_c: '26.5',
      visibility_m: '12',
      current_strength: 'light',
      wave_height_m: '0.5',
      wave_period_s: '8',
      weather: 'clear',
      wildlife: 'turtle, manta',
      coral_health: 'good',
      trash_band: 'noticeable',
      trash_kinds: ['plastic'],
    })
  })

  // Blank and zero are different answers throughout the almanac, and an edit
  // that turned "did not look" into "0" would invent a reading.
  it('leaves an unanswered reading unanswered, and keeps a zero as a zero', () => {
    const form = formStateFrom(record({ air_temp_c: null, visibility_m: 0 }), 'dive')
    expect(form.air_temp_c).toBe('')
    expect(form.visibility_m).toBe('0')
  })

  it('takes the kind from the place, since the record does not carry one', () => {
    expect(formStateFrom(record(), 'adventure').kind).toBe('adventure')
  })

  it('reads the terrain answers back for the kinds that are asked them', () => {
    const form = formStateFrom(
      record({ elevation_m: 1200, route_condition: 'icy', summit_visible: true }),
      'adventure',
    )
    expect(form).toMatchObject({ elevation_m: '1200', route_condition: 'icy', summit_visible: true })
  })

  // The whole point of seeding the form: the RPC writes every column, so a
  // field that did not survive the trip back would be blanked on save.
  it('round-trips to the same arguments the record was filed with', () => {
    const filed = record()
    const args = submitArgs(formStateFrom(filed, 'dive'))
    expect(args).toMatchObject({
      p_site_id: filed.site_id,
      p_obs_date: filed.obs_date,
      p_air_temp_c: filed.air_temp_c,
      p_water_temp_c: filed.water_temp_c,
      p_visibility_m: filed.visibility_m,
      p_current_strength: filed.current_strength,
      p_wave_height_m: filed.wave_height_m,
      p_wave_period_s: filed.wave_period_s,
      p_weather: filed.weather,
      p_wildlife: filed.wildlife,
      p_coral_health: filed.coral_health,
      p_trash_band: filed.trash_band,
      p_trash_kinds: filed.trash_kinds,
    })
  })

  it('round-trips a terrain record too, terrain answers included', () => {
    const filed = record({ elevation_m: 1200, route_condition: 'muddy', summit_visible: false })
    const args = submitArgs(formStateFrom(filed, 'adventure'))
    expect(args).toMatchObject({
      p_elevation_m: 1200, p_route_condition: 'muddy', p_summit_visible: false,
    })
  })
})

describe('the arguments a form is filed with', () => {
  it('sends an unanswered reading as null, not as zero or an empty string', () => {
    const args = submitArgs({ ...emptyForm, site_id: 'site-1', obs_date: '2026-08-01' })
    expect(args.p_air_temp_c).toBeNull()
    expect(args.p_current_strength).toBeNull()
    expect(args.p_trash_band).toBeNull()
    expect(args.p_wildlife).toEqual([])
  })

  // A summit-visible flag on a boat dive is not a false reading; it is a
  // reading of a question nobody was asked.
  it('drops the terrain answers for a kind that is never asked them', () => {
    const args = submitArgs({
      ...emptyForm,
      kind: 'dive',
      site_id: 'site-1',
      obs_date: '2026-08-01',
      elevation_m: '1200',
      route_condition: 'icy',
      summit_visible: true,
    })
    expect(args.p_elevation_m).toBeNull()
    expect(args.p_route_condition).toBeNull()
    expect(args.p_summit_visible).toBeNull()
  })
})

describe('wildlife, as a diver writes it', () => {
  it('splits on commas and drops the whitespace around each name', () => {
    expect(parseWildlife(' turtle ,manta ray,  whale shark ')).toEqual([
      'turtle', 'manta ray', 'whale shark',
    ])
  })

  it('reads an empty box as nothing seen rather than as one blank name', () => {
    expect(parseWildlife('')).toEqual([])
    expect(parseWildlife(' , ')).toEqual([])
  })
})
