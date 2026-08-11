import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiveSiteMapView } from './DiveSiteMapView'
import type { DiveSiteMap } from '../../lib/dive-site-map'

function baseMap(): DiveSiteMap {
  return {
    id: 'site-1',
    name: '測試潛點',
    frame: {},
    provenance: { author: 'A. Cartographer', year: 2015 },
    soundings: [
      { id: 's1', at: { x: 0, y: 0 },   depth_m: 6,  datum: 'unknown', source: 'hand_drawn' },
      { id: 's2', at: { x: 40, y: -20 }, depth_m: 24, datum: 'unknown', source: 'hand_drawn' },
    ],
    features: [
      { id: 'f1', kind: 'wall', label: '大峭壁', source: 'hand_drawn',
        geometry: { shape: 'area', points: [{ x: 10, y: 0 }, { x: 30, y: -10 }, { x: 20, y: -20 }] } },
      { id: 'f2', kind: 'arch', label: 'Arch', source: 'diver',
        geometry: { shape: 'point', at: { x: 15, y: -5 } } },
    ],
    bearings: [{ id: 'b1', from: { x: 0, y: 0 }, degrees: 270 }],
    entries: [{ id: 'e1', at: { x: -5, y: 5 } }],
  }
}

describe('DiveSiteMapView', () => {
  it('renders an empty state rather than a broken drawing for a blank site', () => {
    const map = { ...baseMap(), soundings: [], features: [], bearings: [], entries: [] }
    render(<DiveSiteMapView map={map} />)
    expect(screen.getByText(/nothing has been mapped/i)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('labels the drawing for screen readers with the site name', () => {
    render(<DiveSiteMapView map={baseMap()} />)
    expect(screen.getByRole('img', { name: /測試潛點/ })).toBeInTheDocument()
  })

  it('writes each sounding the way divers read it', () => {
    render(<DiveSiteMapView map={baseMap()} />)
    expect(screen.getByText('-6m')).toBeInTheDocument()
    expect(screen.getByText('-24m')).toBeInTheDocument()
  })

  it('shows the drawn bearing in degrees', () => {
    render(<DiveSiteMapView map={baseMap()} />)
    expect(screen.getByText('270°')).toBeInTheDocument()
  })

  it('keeps the feature names as drawn, untranslated', () => {
    render(<DiveSiteMapView map={baseMap()} />)
    expect(screen.getByText('大峭壁')).toBeInTheDocument()
  })

  it('always attributes the drawing, so provenance cannot be cropped off', () => {
    render(<DiveSiteMapView map={baseMap()} />)
    expect(screen.getByText(/drawn by a\. cartographer, 2015/i)).toBeInTheDocument()
  })

  it('reproduces the source accuracy note when there is one', () => {
    const map = baseMap()
    map.provenance.note = 'For reference only, not 100% accurate.'
    render(<DiveSiteMapView map={map} />)
    expect(screen.getByText(/not 100% accurate/i)).toBeInTheDocument()
  })

  it('says plainly when depths carry no vertical datum', () => {
    render(<DiveSiteMapView map={baseMap()} />)
    expect(screen.getByText(/no vertical datum stated/i)).toBeInTheDocument()
  })

  it('names the datum once every sounding has been reduced to it', () => {
    const map = baseMap()
    map.soundings = map.soundings.map(s => ({ ...s, datum: 'TWCD2021' as const }))
    render(<DiveSiteMapView map={map} />)
    expect(screen.getByText(/reduced to TWCD2021/i)).toBeInTheDocument()
  })

  it('does not claim a datum when soundings are mixed', () => {
    const map = baseMap()
    map.soundings[1] = { ...map.soundings[1], datum: 'TWCD2021', source: 'diver' }
    render(<DiveSiteMapView map={map} />)
    expect(screen.getByText(/no vertical datum stated/i)).toBeInTheDocument()
  })

  it('draws north up — the south-east sounding sits below and right of the origin', () => {
    const { container } = render(<DiveSiteMapView map={baseMap()} />)
    const labels = Array.from(container.querySelectorAll('text'))
    const shallow = labels.find(el => el.textContent === '-6m')!
    const deep = labels.find(el => el.textContent === '-24m')!
    expect(Number(deep.getAttribute('x'))).toBeGreaterThan(Number(shallow.getAttribute('x')))
    expect(Number(deep.getAttribute('y'))).toBeGreaterThan(Number(shallow.getAttribute('y')))
  })

  it('scales to its container instead of forcing a fixed width', () => {
    const { container } = render(<DiveSiteMapView map={baseMap()} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('class')).toContain('w-full')
    expect(svg.getAttribute('viewBox')).toBeTruthy()
    expect(svg.getAttribute('width')).toBeNull()
  })
})
