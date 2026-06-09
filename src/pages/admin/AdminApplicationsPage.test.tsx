import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AdminApplicationsPage } from './AdminApplicationsPage'
import { mockQueryBuilder } from '../../../tests/test-utils'

const { from, invoke, fetchEventsForBookings } = vi.hoisted(() => ({
  from:                  vi.fn(),
  invoke:                vi.fn(),
  fetchEventsForBookings: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => from(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}))

vi.mock('../../lib/events', () => ({
  fetchEventsForBookings: (...a: unknown[]) => fetchEventsForBookings(...a),
  formatEventSpan: () => '2026-05-10',
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn() }),
}))

beforeEach(() => {
  from.mockReset()
  invoke.mockReset()
  fetchEventsForBookings.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminApplicationsPage />
    </MemoryRouter>
  )
}

describe('AdminApplicationsPage', () => {
  it('renders empty-state when no pending applications', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: [] }))
    renderPage()
    expect(await screen.findByText(/no pending applications/i)).toBeInTheDocument()
    expect(screen.getByText('0 pending')).toBeInTheDocument()
  })

  it('lists pending profiles newest first and shows the count', async () => {
    from.mockReturnValueOnce(mockQueryBuilder({
      data: [
        { id: 'u1', name: 'Alice', created_at: '2026-04-30T00:00:00Z', status: 'pending' },
        { id: 'u2', name: 'Bob',   created_at: '2026-04-29T00:00:00Z', status: 'pending' },
      ],
    }))
    renderPage()
    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('2 pending')).toBeInTheDocument()
  })

  it('approve calls notify-application-decision and removes the row', async () => {
    from.mockReturnValueOnce(mockQueryBuilder({
      data: [{ id: 'u1', name: 'Alice', created_at: '2026-04-30T00:00:00Z', status: 'pending' }],
    }))
    // Second from() call when user expands to look up first booking
    from.mockReturnValueOnce(mockQueryBuilder({ data: [] }))
    invoke.mockResolvedValue({ data: { ok: true, status: 'active', email_sent: true }, error: null })

    renderPage()
    fireEvent.click(await screen.findByText('Alice'))

    fireEvent.click(await screen.findByRole('button', { name: /approve/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'notify-application-decision',
      { body: { user_id: 'u1', decision: 'approve' } },
    ))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(toastSuccess.mock.calls[0][0]).toMatch(/approved/i)
    expect(toastSuccess.mock.calls[0][0]).toMatch(/email sent/i)
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })

  it('reject sends the typed reason in the body', async () => {
    from.mockReturnValueOnce(mockQueryBuilder({
      data: [{ id: 'u1', name: 'Alice', created_at: '2026-04-30T00:00:00Z', status: 'pending' }],
    }))
    from.mockReturnValueOnce(mockQueryBuilder({ data: [] }))
    invoke.mockResolvedValue({ data: { ok: true, status: 'rejected', email_sent: true }, error: null })

    renderPage()
    fireEvent.click(await screen.findByText('Alice'))

    fireEvent.change(
      await screen.findByPlaceholderText(/optional rejection reason/i),
      { target: { value: 'incomplete profile' } },
    )
    fireEvent.click(screen.getByRole('button', { name: /reject/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'notify-application-decision',
      { body: { user_id: 'u1', decision: 'reject', reason: 'incomplete profile' } },
    ))
  })

  it('shows an error toast when the function call fails', async () => {
    from.mockReturnValueOnce(mockQueryBuilder({
      data: [{ id: 'u1', name: 'Alice', created_at: '2026-04-30T00:00:00Z', status: 'pending' }],
    }))
    from.mockReturnValueOnce(mockQueryBuilder({ data: [] }))
    invoke.mockResolvedValue({ data: null, error: { message: 'forbidden' } })

    renderPage()
    fireEvent.click(await screen.findByText('Alice'))
    fireEvent.click(await screen.findByRole('button', { name: /approve/i }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError.mock.calls[0][0]).toMatch(/forbidden/i)
    // Row stays — only successful decisions remove it.
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })
})
