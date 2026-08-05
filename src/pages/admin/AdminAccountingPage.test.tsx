import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AdminAccountingPage } from './AdminAccountingPage'
import { siteConfig } from '../../config/site'

const { from, useAuthMock } = vi.hoisted(() => ({ from: vi.fn(), useAuthMock: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn() }),
}))

const requestEventDiverExport = vi.fn()
vi.mock('../../lib/admin-event-export', () => ({
  requestEventDiverExport: (...a: unknown[]) => requestEventDiverExport(...a),
}))

function tableBuilder(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'gte', 'lt', 'lte', 'order', 'in', 'eq', 'is', 'not', 'or']) b[m] = () => b
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
  useAuthMock.mockReset()
  useAuthMock.mockReturnValue({ profile: { id: 'admin-1', role: 'admin' } })
  // Default: every table empty, so the manifest section's on-mount dive query
  // resolves cleanly. Individual tests override with mockTables().
  mockTables({})
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
    // Fiscal-year select plus the manifest section's dive select.
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(2)
  })

  it('emails a boat manifest for the picked dive', async () => {
    requestEventDiverExport.mockReset()
    requestEventDiverExport.mockResolvedValue({ ok: true, diver_count: 3, staff_count: 1 })
    mockTables({ events: [{ id: 'dive1', display_title: 'Long Dong Bay', admin_title: null, start_date: '2026-08-03' }] })
    renderPage()

    const option = await screen.findByRole('option', { name: /Long Dong Bay/ })
    const select = option.closest('select')!
    fireEvent.change(select, { target: { value: 'dive1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Email manifest' }))

    await waitFor(() => expect(requestEventDiverExport).toHaveBeenCalledWith('dive', 'dive1', expect.any(Object)))
    await waitFor(() => expect(toastSuccess.mock.calls[0][0]).toMatch(/Manifest emailed/))
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

// One dive in the current season with two rostered guides and a single
// confirmed booking paid in full — so the takings split evenly between them.
function seasonWithOneDive(year: number) {
  return {
    duties: [
      { event_id: 'd1', assignee_id: 'staff-1', role: 'guide' },
      { event_id: 'd1', assignee_id: 'staff-2', role: 'guide' },
    ],
    events: [{
      id: 'd1', kind: 'dive', admin_title: 'Bat Cave', display_title: null,
      start_date: `${year}-01-04`, end_date: null, course_days: null, cancelled_at: null, price: null,
    }],
    // One diver at a 3,000 base fee — the dive is worth 3,000, halved between
    // the two rostered guides.
    bookings: [{ id: 'b1', event_id: 'd1', status: 'confirmed', details: { charges: [{ kind: 'base', amount: 3000 }] } }],
    profiles: [
      { id: 'staff-1', name: 'Sam Reef', nickname: 'Sam' },
      { id: 'staff-2', name: 'Val Kelp', nickname: 'Val' },
    ],
  }
}

describe('AdminAccountingPage revenue tab', () => {
  it('shows an admin both tabs and the whole crew on the revenue one', async () => {
    mockTables(seasonWithOneDive(new Date().getFullYear()))
    renderPage()

    fireEvent.click(screen.getByRole('tab', { name: 'Revenue' }))
    // Two rostered guides, so the dive's takings halve between them. Scoped to
    // the table — the crew picker lists the same names as <option>s.
    const table = within(await screen.findByRole('table'))
    expect(table.getByText('Sam')).toBeInTheDocument()
    expect(table.getByText('Val')).toBeInTheDocument()
    expect(table.getAllByText(`${siteConfig.locale.currencyLabel} 1,500`)).toHaveLength(2)
  })

  it('lets an admin pick one crew member out of the comparison', async () => {
    mockTables(seasonWithOneDive(new Date().getFullYear()))
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Revenue' }))

    const crew = await screen.findByLabelText('Crew')
    // Every admin/staff profile is offered, not only those with revenue.
    expect(within(crew).getAllByRole('option').map(o => o.textContent))
      .toEqual(['All crew', 'Sam', 'Val'])

    fireEvent.change(crew, { target: { value: 'staff-1' } })
    // Narrowed to one person: their month breakdown replaces the crew table,
    // so Val survives only as an option in the picker.
    expect(await screen.findByText('By month')).toBeInTheDocument()
    expect(screen.getAllByText('Val')).toHaveLength(1)
    expect(screen.getByText('Val').tagName).toBe('OPTION')
  })

  it('expands a month row into the events behind it', async () => {
    mockTables(seasonWithOneDive(new Date().getFullYear()))
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Revenue' }))
    fireEvent.change(await screen.findByLabelText('Crew'), { target: { value: 'staff-1' } })

    const month = await screen.findByRole('button', { name: /^\d{4}-\d{2}$/ })
    expect(screen.queryByRole('link', { name: 'Bat Cave' })).not.toBeInTheDocument()
    fireEvent.click(month)
    expect(await screen.findByRole('link', { name: 'Bat Cave' })).toHaveAttribute('href', '/admin/events/d1')
  })

  it('collapses the type breakdown into Courses and Dives, expanding on click', async () => {
    mockTables(seasonWithOneDive(new Date().getFullYear()))
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Revenue' }))
    fireEvent.change(await screen.findByLabelText('Crew'), { target: { value: 'staff-1' } })

    // Only the group this person worked shows — no empty "Courses" row.
    const groups = await screen.findAllByRole('button', { name: /Courses|Dives/ })
    expect(groups.map(g => g.textContent)).toEqual([expect.stringContaining('Dives')])

    fireEvent.click(groups[0])
    expect(await screen.findByText(/Bat Cave/)).toBeInTheDocument()
  })

  it('says so plainly when the picked person earned nothing that season', async () => {
    const season = seasonWithOneDive(new Date().getFullYear())
    season.profiles.push({ id: 'staff-3', name: 'Nia Shoal', nickname: 'Nia' })
    mockTables(season)
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Revenue' }))

    fireEvent.change(await screen.findByLabelText('Crew'), { target: { value: 'staff-3' } })
    expect(await screen.findByText(/Nothing attributed to this person/)).toBeInTheDocument()
  })

  it('gives a staff viewer their own figures and no tabs or exports', async () => {
    useAuthMock.mockReturnValue({ profile: { id: 'staff-1', role: 'staff' } })
    mockTables(seasonWithOneDive(new Date().getFullYear()))
    renderPage()

    expect(await screen.findAllByText(`${siteConfig.locale.currencyLabel} 1,500`)).not.toHaveLength(0)
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download ZIP' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Email manifest' })).not.toBeInTheDocument()
  })

  it('keeps the unattributed roster-gap block away from staff', async () => {
    const season = seasonWithOneDive(new Date().getFullYear())
    // Nobody rostered who can earn: the dive's takings belong to no one.
    season.duties = [{ event_id: 'd1', assignee_id: 'staff-1', role: 'support' }]

    useAuthMock.mockReturnValue({ profile: { id: 'admin-1', role: 'admin' } })
    mockTables(season)
    const view = renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Revenue' }))
    expect(await screen.findByText('Unattributed')).toBeInTheDocument()
    view.unmount()

    useAuthMock.mockReturnValue({ profile: { id: 'staff-1', role: 'staff' } })
    mockTables(season)
    renderPage()
    await waitFor(() => expect(screen.getByText(/no completed events/i)).toBeInTheDocument())
    expect(screen.queryByText('Unattributed')).not.toBeInTheDocument()
  })
})
