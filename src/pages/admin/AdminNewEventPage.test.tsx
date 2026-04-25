import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AdminNewEventPage } from './AdminNewEventPage'
import { mockQueryBuilder } from '../../../tests/test-utils'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

beforeEach(() => {
  from.mockReset()
})

function fakeCatalog() {
  // The page fetches three catalog tables on mount before submit is enabled.
  // Hand each lookup a tiny fixture so the FK pickers actually render rows.
  from.mockImplementation((table: string) => {
    if (table === 'EO_prices') return mockQueryBuilder({ data: [{ _id: 'price-1', title: 'Standard',  starting_at: 5000 }] })
    if (table === 'EO_rooms')  return mockQueryBuilder({ data: [{ _id: 'room-1',  display_name: 'Twin', title: 'Twin' }] })
    if (table === 'Other_Addons') return mockQueryBuilder({ data: [{ _id: 'addon-1', display_name: 'Nitrox', title: 'Nitrox' }] })
    return mockQueryBuilder({ data: [] })
  })
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/new']}>
      <Routes>
        <Route path="/admin/new"               element={<AdminNewEventPage />} />
        <Route path="/admin/events/dive/:id"   element={<div>DIVE_DETAIL</div>} />
        <Route path="/admin/events/course/:id" element={<div>COURSE_DETAIL</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AdminNewEventPage', () => {
  it('defaults to dive type and exposes the dive-only sections', async () => {
    fakeCatalog()
    renderPage()
    expect(await screen.findByRole('heading', { name: /new event/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/dive title/i)).toBeInTheDocument()
    expect(screen.getByText(/dive details/i)).toBeInTheDocument()
    // Course-only sections should be absent
    expect(screen.queryByText(/course details/i)).not.toBeInTheDocument()
  })

  it('switches to course mode when the course pill is clicked', async () => {
    fakeCatalog()
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Course' }))
    expect(screen.getByLabelText(/course title/i)).toBeInTheDocument()
    expect(screen.getByText(/course details/i)).toBeInTheDocument()
    expect(screen.queryByText(/dive details/i)).not.toBeInTheDocument()
  })

  it('blocks submit when dive title is missing', async () => {
    fakeCatalog()
    const user = userEvent.setup()
    renderPage()
    // Browser form validation kicks in before our handler — fill start_date so
    // the dive_title required attribute is the only thing left.
    await screen.findByLabelText(/dive title/i)
    await user.click(screen.getByRole('button', { name: /create dive/i }))
    // We never navigated, so the new-event heading is still visible.
    expect(screen.getByRole('heading', { name: /new event/i })).toBeInTheDocument()
  })

  it('inserts a dive with minimum required fields and navigates to its detail page', async () => {
    const insert = vi.fn().mockReturnValue({ then: (cb: (r: { error: null }) => void) => Promise.resolve({ error: null }).then(cb) })
    from.mockImplementation((table: string) => {
      if (table === 'EO_prices')    return mockQueryBuilder({ data: [] })
      if (table === 'EO_rooms')     return mockQueryBuilder({ data: [] })
      if (table === 'Other_Addons') return mockQueryBuilder({ data: [] })
      if (table === 'EO_dives')     return { insert }
      return mockQueryBuilder({ data: [] })
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/dive title/i)
    await user.type(screen.getByLabelText(/dive title/i), 'Green Island Day Trip')
    await user.type(screen.getByLabelText(/start date/i),  '2026-06-01')
    await user.click(screen.getByRole('button', { name: /create dive/i }))
    await waitFor(() => expect(insert).toHaveBeenCalled())
    const payload = (insert.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(payload.dive_title).toBe('Green Island Day Trip')
    expect(payload.start_date).toBe('2026-06-01')
    expect(typeof payload._id).toBe('string')
    expect(await screen.findByText('DIVE_DETAIL')).toBeInTheDocument()
  })
})
