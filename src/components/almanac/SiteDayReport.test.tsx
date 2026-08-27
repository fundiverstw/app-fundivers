import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SiteDayReport } from './SiteDayReport'
import { t } from '../../i18n'
import type { AlmanacEventRecord } from '../../types/database'

const base: AlmanacEventRecord = {
  id: 'record-1',
  site_id: 'site-1',
  site_name: 'Bat Cave',
  site_kind: 'dive',
  created_at: '2026-08-02T00:00:00Z',
  obs_date: '2026-08-01',
  air_temp_c: 30,
  water_temp_c: 28,
  visibility_m: 12,
  current_strength: 'light',
  wave_height_m: null,
  wave_period_s: null,
  weather: 'clear',
  wildlife: ['turtle'],
  coral_health: null,
  elevation_m: null,
  route_condition: null,
  summit_visible: null,
  trash_count: null,
  trash_kinds: [],
  diver_display: 'Mei',
}

const day: AlmanacEventRecord[] = [
  base,
  { ...base, id: 'record-2', water_temp_c: 27, visibility_m: 8, current_strength: 'moderate', weather: 'rain', wildlife: ['turtle', 'manta'], diver_display: 'Jun' },
  { ...base, id: 'record-3', water_temp_c: 29, visibility_m: 15, current_strength: 'light', weather: 'clear', wildlife: [], diver_display: 'Ana' },
]

function renderReport(records: AlmanacEventRecord[]) {
  return render(<SiteDayReport siteName="Bat Cave" dateLabel="Aug 1, 2026" records={records} />)
}

describe('SiteDayReport', () => {
  it('plots the trash count and tallies what it was made of', () => {
    renderReport([
      { ...base, trash_count: 12, trash_kinds: ['plastic', 'fishing_gear'] },
      { ...base, id: 'record-2', diver_display: 'Jun', trash_count: 4, trash_kinds: ['plastic'] },
    ])

    const readings = screen.getByText(t.almanac.measured).closest('section')!
    const trash = within(readings).getByText(t.almanac.trashCount).closest('div')!.parentElement!
    expect(within(trash).getByText('8')).toBeInTheDocument()

    const conditions = screen.getByText(t.almanac.called).closest('section')!
    const kinds = within(conditions).getByText(t.almanac.trashKindsLabel).closest('div')!
    expect(within(kinds).getByText(t.almanac.trashKinds.plastic).parentElement).toHaveTextContent('2')
    expect(within(kinds).getByText(t.almanac.trashKinds.fishing_gear).parentElement).toHaveTextContent('1')
  })

  // "Nobody looked" and "everyone looked and it was clean" are different
  // findings, and averaging one as the other is the failure this feature
  // exists to avoid.
  it('reads a day of zeroes as a clean site, not as an unsurveyed one', () => {
    renderReport([
      { ...base, trash_count: 0 },
      { ...base, id: 'record-2', diver_display: 'Jun', trash_count: 0 },
    ])

    const readings = screen.getByText(t.almanac.measured).closest('section')!
    expect(within(readings).getByText(t.almanac.trashCount)).toBeInTheDocument()
    const who = screen.getByText(t.almanac.whoReported).closest('section')!
    expect(within(who).getAllByText(t.almanac.trashNone)).toHaveLength(2)
  })

  it('leaves trash out entirely when nobody answered', () => {
    renderReport([base])

    const readings = screen.getByText(t.almanac.measured).closest('section')!
    expect(within(readings).queryByText(t.almanac.trashCount)).not.toBeInTheDocument()
  })

  it('leads with how much data the day is and who filed it', () => {
    const { container } = renderReport(day)

    const header = container.querySelector('header')!
    expect(within(header).getByRole('heading', { name: 'Bat Cave' })).toBeInTheDocument()
    expect(within(header).getByText('Aug 1, 2026')).toBeInTheDocument()
    expect(within(header).getByText(t.almanac.observationCount(3))).toBeInTheDocument()
    expect(within(header).getByText(t.almanac.recordsFrom('Mei, Jun, Ana'))).toBeInTheDocument()
  })

  it('plots only the metrics the day actually carries', () => {
    renderReport(day)

    const readings = screen.getByText(t.almanac.measured).closest('section')!
    expect(within(readings).getByText(t.almanac.waterTemp)).toBeInTheDocument()
    expect(within(readings).getByText(t.almanac.visibility)).toBeInTheDocument()
    // Nobody logged waves or elevation, so those get no plot at all.
    expect(within(readings).queryByText(t.almanac.waveHeight)).not.toBeInTheDocument()
    expect(within(readings).queryByText(t.almanac.elevation)).not.toBeInTheDocument()
  })

  it('averages the numbers and counts what the conditions were called', () => {
    renderReport(day)

    // Water temp 28 / 27 / 29 → 28.0 on its own track, dots and all.
    const readings = screen.getByText(t.almanac.measured).closest('section')!
    const waterTemp = within(readings).getByText(t.almanac.waterTemp).closest('div')!.parentElement!
    expect(within(waterTemp).getByText('28.0°C')).toBeInTheDocument()
    expect(waterTemp.querySelectorAll('circle')).toHaveLength(3)
    const conditions = screen.getByText(t.almanac.called).closest('section')!
    const currents = within(conditions).getByText(t.almanac.current).closest('div')!
    expect(within(currents).getByText(t.almanac.currentStrengths.light).parentElement)
      .toHaveTextContent('2')
  })

  it('writes out every diver\'s own readings under the plots', () => {
    renderReport(day)

    const who = screen.getByText(t.almanac.whoReported).closest('section')!
    expect(within(who).getAllByRole('listitem')).toHaveLength(3)
    expect(within(who).getByText(t.almanac.recordsFrom('Jun'))).toBeInTheDocument()
  })

  it('says so plainly when the day holds nothing for that place', () => {
    renderReport([])

    expect(screen.getByText(t.almanac.noDayRecords)).toBeInTheDocument()
    expect(screen.queryByText(t.almanac.measured)).not.toBeInTheDocument()
  })
})
