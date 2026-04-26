import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { MapPage } from './MapPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <MapPage />
    </MemoryRouter>
  )
}

// Picks the matching control from the region-list grid below the map (every
// region has both a marker and a button — querying by role + name returns
// both, the list one is unambiguous).
function listButton(name: RegExp | string) {
  const buttons = screen.getAllByRole('button', { name })
  return buttons[buttons.length - 1]
}

describe('MapPage', () => {
  it('shows nothing in the details panel until a region is picked', () => {
    renderPage()
    // The region-list buttons exist (overview state), but no info panel.
    expect(listButton(/keelung/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /keelung \/ badouzi/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /kenting/i })).not.toBeInTheDocument()
  })

  it('expands a region on click and lists its dive sites', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(listButton(/long dong bay/i))
    expect(screen.getByRole('heading', { name: /long dong bay/i })).toBeInTheDocument()
    expect(screen.getByText(/First Cave/)).toBeInTheDocument()
  })

  it('switches the panel when a different region is picked', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(listButton(/long dong bay/i))
    await user.click(listButton(/lanyu/i))
    expect(screen.queryByRole('heading', { name: /long dong bay/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /lanyu/i })).toBeInTheDocument()
    expect(screen.getByText(/Eight Generations/)).toBeInTheDocument()
  })

  it('toggles a region closed when its list button is tapped twice', async () => {
    const user = userEvent.setup()
    renderPage()
    const south = listButton(/kenting/i)
    await user.click(south)
    expect(screen.getByRole('heading', { name: /kenting/i })).toBeInTheDocument()
    await user.click(south)
    expect(screen.queryByRole('heading', { name: /kenting/i })).not.toBeInTheDocument()
  })

  it('closes the panel via the Back to overview button', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(listButton(/green island/i))
    expect(screen.getByRole('heading', { name: /green island/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /back to overview/i }))
    expect(screen.queryByRole('heading', { name: /green island/i })).not.toBeInTheDocument()
  })

  it('renders all seven regions in the list', () => {
    renderPage()
    const grid = listButton(/penghu/i).parentElement!
    const { getAllByRole } = within(grid)
    // 7 region buttons in the grid.
    expect(getAllByRole('button')).toHaveLength(7)
  })
})
