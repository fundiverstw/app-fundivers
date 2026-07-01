import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { MapPage } from './MapPage'
import { mockQueryBuilder } from '../../tests/test-utils'
import { siteConfig } from '../config/site'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

beforeEach(() => {
  from.mockReset()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <MapPage />
    </MemoryRouter>
  )
}

// The list-grid below the map mirrors every region marker, so role+name
// returns two matches per region. The list button is always last.
function listButton(name: RegExp | string) {
  const buttons = screen.getAllByRole('button', { name })
  return buttons[buttons.length - 1]
}

const SAMPLE_SITES = [
  { id: 's1', name: 'Long Dong Bay', tagline: 'Walk-in ramp.',          latitude: 25.1133, longitude: 121.9201, region: 'longdong', dive_type: 'shore', created_at: '', updated_at: '' },
  { id: 's2', name: 'Canyons',       tagline: 'Slopes and walls.',      latitude: 25.1226, longitude: 121.9041, region: 'longdong', dive_type: 'shore', created_at: '', updated_at: '' },
  { id: 's3', name: 'Iron House 2',  tagline: 'Metal frame structures.', latitude: 25.1460, longitude: 121.8160, region: 'keelung',  dive_type: 'boat',  created_at: '', updated_at: '' },
  { id: 's4', name: 'Bat Cave',      tagline: 'For all levels.',         latitude: 25.1263, longitude: 121.8321, region: 'keelung',  dive_type: 'shore', created_at: '', updated_at: '' },
]

function fakeSites(rows = SAMPLE_SITES) {
  from.mockImplementation(() => mockQueryBuilder({ data: rows }))
}

describe('MapPage', () => {
  it('shows nothing in the details panel until a region is picked', async () => {
    fakeSites()
    renderPage()
    expect(listButton(/keelung/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /keelung \/ badouzi/i })).not.toBeInTheDocument()
  })

  it('expands a region on click and lists its dive sites', async () => {
    fakeSites()
    const user = userEvent.setup()
    renderPage()
    await user.click(listButton(/long dong bay/i))
    expect(screen.getByRole('heading', { name: /long dong bay/i })).toBeInTheDocument()
    // Site label appears both as SVG marker text and in the panel list,
    // once the fetch resolves.
    await waitFor(() => {
      expect(screen.getAllByText(/Canyons/).length).toBeGreaterThan(0)
    })
  })

  it('links a site to its Wix travel-destination page when it has a slug', async () => {
    fakeSites([
      { id: 'w1', name: 'Wan An Jian Navy Wreck', tagline: 'Navy wreck.', latitude: 24.9618, longitude: 121.9458, region: 'yilan', dive_type: 'boat', wix_slug: 'wan-an-jian-navy-wreck', created_at: '', updated_at: '' },
      { id: 'w2', name: 'Cathedral', tagline: 'Surprises.', latitude: 25.0328, longitude: 121.9426, region: 'yilan', dive_type: 'boat', wix_slug: null, created_at: '', updated_at: '' },
    ])
    const user = userEvent.setup()
    renderPage()
    await user.click(listButton(/yilan/i))

    // The name links out from both the map marker and the panel list.
    await waitFor(() => expect(screen.getAllByRole('link', { name: 'Wan An Jian Navy Wreck' }).length).toBe(2))
    for (const link of screen.getAllByRole('link', { name: 'Wan An Jian Navy Wreck' })) {
      expect(link).toHaveAttribute('href', `${siteConfig.urls.travelDestinationsBase}wan-an-jian-navy-wreck`)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    }
    // A site without a slug stays plain text, not a link.
    expect(screen.queryByRole('link', { name: 'Cathedral' })).not.toBeInTheDocument()
  })

  it('switches the panel when a different region is picked', async () => {
    fakeSites()
    const user = userEvent.setup()
    renderPage()
    await user.click(listButton(/long dong bay/i))
    await user.click(listButton(/lanyu/i))
    expect(screen.queryByRole('heading', { name: /long dong bay/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /lanyu/i })).toBeInTheDocument()
    // Lanyu's region description mentions the Badai Wreck.
    expect(screen.getByText(/Badai Wreck/)).toBeInTheDocument()
  })

  it('toggles a region closed when its list button is tapped twice', async () => {
    fakeSites()
    const user = userEvent.setup()
    renderPage()
    const south = listButton(/kenting/i)
    await user.click(south)
    expect(screen.getByRole('heading', { name: /kenting/i })).toBeInTheDocument()
    await user.click(south)
    expect(screen.queryByRole('heading', { name: /kenting/i })).not.toBeInTheDocument()
  })

  it('closes the panel via the Back to overview button', async () => {
    fakeSites()
    const user = userEvent.setup()
    renderPage()
    await user.click(listButton(/green island/i))
    expect(screen.getByRole('heading', { name: /green island/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /back to overview/i }))
    expect(screen.queryByRole('heading', { name: /green island/i })).not.toBeInTheDocument()
  })

  it('renders all eight regions in the list', () => {
    fakeSites()
    renderPage()
    const grid = listButton(/penghu/i).parentElement!
    const { getAllByRole } = within(grid)
    expect(getAllByRole('button')).toHaveLength(8)
  })

  it('renders fetched site markers when zoomed in', async () => {
    fakeSites()
    const user = userEvent.setup()
    renderPage()
    await user.click(listButton(/keelung/i))
    // 2 keelung sites in the fixture: each shows up in SVG + list.
    await waitFor(() => {
      expect(screen.getAllByText(/Iron House 2/).length).toBeGreaterThanOrEqual(2)
      expect(screen.getAllByText(/Bat Cave/).length).toBeGreaterThanOrEqual(2)
    })
  })

  it('hides shore-only sites when the Shore toggle is off', async () => {
    fakeSites()
    const user = userEvent.setup()
    renderPage()
    await user.click(listButton(/keelung/i))
    // Both Iron House 2 (boat) and Bat Cave (shore) appear before toggling.
    await waitFor(() => {
      expect(screen.getAllByText(/Iron House 2/).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/Bat Cave/).length).toBeGreaterThan(0)
    })
    await user.click(screen.getByRole('button', { name: /toggle shore dives/i }))
    // Bat Cave (shore) disappears; Iron House 2 (boat) remains.
    await waitFor(() => {
      expect(screen.queryByText(/Bat Cave/)).not.toBeInTheDocument()
    })
    expect(screen.getAllByText(/Iron House 2/).length).toBeGreaterThan(0)
  })

  it('falls back to an empty site list if the fetch errors', async () => {
    from.mockImplementation(() => mockQueryBuilder({ error: { message: 'boom' } }))
    const user = userEvent.setup()
    renderPage()
    await user.click(listButton(/penghu/i))
    // Panel still renders with the region description.
    expect(screen.getByRole('heading', { name: /penghu/i })).toBeInTheDocument()
    expect(screen.getByText(/most fish in numbers/)).toBeInTheDocument()
  })
})
