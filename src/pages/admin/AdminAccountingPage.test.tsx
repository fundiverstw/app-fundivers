import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AdminAccountingPage } from './AdminAccountingPage'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn() }),
}))

function tableBuilder(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'gte', 'lt', 'order', 'in', 'eq']) b[m] = () => b
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej)
  return b
}

function mockTables(tables: Record<string, unknown[]>) {
  from.mockImplementation((table: string) =>
    tableBuilder({ data: tables[table] ?? [], error: null }))
}

beforeEach(() => {
  from.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(URL as any).createObjectURL = vi.fn(() => 'blob:x')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(URL as any).revokeObjectURL = vi.fn()
})

function renderPage() {
  return render(<MemoryRouter><AdminAccountingPage /></MemoryRouter>)
}

describe('AdminAccountingPage', () => {
  it('renders a fiscal-year picker and a download button', () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'Download ZIP' })).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('builds the ZIP and toasts a count when payments exist', async () => {
    mockTables({
      payments: [{
        id: 'p1', created_at: '2026-03-01T08:00:00.000Z', user_id: 'd1', booking_id: 'b1',
        amount: 1000, currency: 'TWD', status: 'paid', method: 'cash', note: null, recorded_by: 'a1',
      }],
      bookings: [{ id: 'b1', user_id: 'd1', event_id: 'dive1', status: 'confirmed', details: { total: 1000 } }],
      events: [{ id: 'dive1', kind: 'dive', display_title: 'Long Dong Bay', admin_title: null, start_date: '2026-03-14', course_days: null }],
      profiles: [{ id: 'd1', name: 'Dana', email: 'd@x.com' }, { id: 'a1', name: 'Avi', email: null }],
    })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Download ZIP' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(toastSuccess.mock.calls[0][0]).toMatch(/Exported 1 transaction \(1 paid\)/)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((URL as any).createObjectURL).toHaveBeenCalled()
  })

  it('warns and skips the download when there are no payments in the year', async () => {
    mockTables({ payments: [] })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Download ZIP' }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError.mock.calls[0][0]).toMatch(/No payments recorded/)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((URL as any).createObjectURL).not.toHaveBeenCalled()
  })
})
