import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AlmanacPage } from './AlmanacPage'

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-user' },
    profile: { role: 'diver' },
    loading: false,
  }),
}))

vi.mock('../lib/events', () => ({
  fetchEventsInRange: vi.fn().mockResolvedValue([]),
  formatEventSpan: () => 'Jan 1',
  isPastEvent: vi.fn().mockReturnValue(true),
  todayIso: () => '2026-08-18',
  addIsoDays: () => '2026-08-18',
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}))

function renderPage() {
  return render(<MemoryRouter><AlmanacPage /></MemoryRouter>)
}

describe('AlmanacPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders the title and blurb', () => {
    renderPage()
    expect(screen.getByText(/almanac/i)).toBeInTheDocument()
  })

  it('shows the submit form after loading', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.queryByText(/loading almanac/i)).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /submit observation/i })).toBeInTheDocument()
  })

  it('shows the records heading after loading', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.queryByText(/loading almanac/i)).not.toBeInTheDocument()
    })
    expect(screen.getByText(/past observations/i)).toBeInTheDocument()
  })
})
