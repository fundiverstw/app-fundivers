import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AdminApplicationsPage } from './AdminApplicationsPage'
import { t } from '../../i18n'

const ap = t.admin.applications
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
  it('renders empty-state when no account is on hold', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: [] }))
    renderPage()
    expect(await screen.findByText(ap.none)).toBeInTheDocument()
    expect(screen.getByText(ap.pendingCount(0))).toBeInTheDocument()
  })

  it('lists on-hold profiles newest first and shows the count', async () => {
    from.mockReturnValueOnce(mockQueryBuilder({
      data: [
        { id: 'u1', name: 'Alice', created_at: '2026-04-30T00:00:00Z', status: 'pending' },
        { id: 'u2', name: 'Bob',   created_at: '2026-04-29T00:00:00Z', status: 'pending' },
      ],
    }))
    renderPage()
    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText(ap.pendingCount(2))).toBeInTheDocument()
  })

  // Regression: the query also required `application_submitted_at is not null`.
  // That column is stamped by a trigger only once name, DOB, cert level and
  // both contact fields are filled in, so a diver who signed up and stopped
  // short never got it — and was invisible on the only screen that can approve
  // them. On production that hid every single pending diver, all 26 of them.
  it('lists an on-hold diver who never completed their profile', async () => {
    const calls: Array<{ method: string; args: unknown[] }> = []
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'not', 'is', 'order', 'limit']) {
      builder[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return builder }
    }
    builder.then = (onFulfilled?: (r: unknown) => unknown) =>
      Promise.resolve({
        data: [{ id: 'u1', name: 'Leo', created_at: '2026-04-30T00:00:00Z', status: 'pending', application_submitted_at: null }],
        error: null,
      }).then(onFulfilled)
    from.mockReturnValueOnce(builder)

    renderPage()

    expect(await screen.findByText('Leo')).toBeInTheDocument()
    expect(screen.getByText(ap.pendingCount(1))).toBeInTheDocument()
    // Nothing may narrow the queue beyond status='pending'.
    expect(calls.some(c => c.args.some(a => a === 'application_submitted_at' && c.method === 'not'))).toBe(false)
  })

  it('flags an incomplete profile rather than hiding it, and names the gaps', async () => {
    from.mockReturnValueOnce(mockQueryBuilder({
      data: [{
        id: 'u1', name: 'Leo', created_at: '2026-04-30T00:00:00Z', status: 'pending',
        application_submitted_at: null,
        date_of_birth: '1990-01-01', contact_method: 'line', contact_id: 'leo-line',
        cert_level: 'OW', nationality: null, gender: null,
      }],
    }))
    renderPage()
    expect(await screen.findByText('Leo')).toBeInTheDocument()
    expect(screen.getByText(/profile incomplete/i)).toBeInTheDocument()
    // The two blanks, named — and nothing the diver did fill in.
    const gaps = screen.getByText(/still missing/i).textContent ?? ''
    expect(gaps).toMatch(/nationality/i)
    expect(gaps).toMatch(/gender/i)
    expect(gaps).not.toMatch(/birth/i)
  })

  it('does not flag a diver who did complete their profile', async () => {
    from.mockReturnValueOnce(mockQueryBuilder({
      data: [{
        id: 'u2', name: 'Ada', created_at: '2026-04-30T00:00:00Z', status: 'pending',
        application_submitted_at: '2026-04-30T01:00:00Z',
        date_of_birth: '1990-01-01', nationality: 'TW', gender: 'female',
        contact_method: 'line', contact_id: 'ada-line', cert_level: 'AOW',
      }],
    }))
    renderPage()
    expect(await screen.findByText('Ada')).toBeInTheDocument()
    expect(screen.queryByText(/profile incomplete/i)).not.toBeInTheDocument()
  })

  // The DB trigger that stamps application_submitted_at requires a cert_level,
  // which a Discover diver will never have — driving the badge off that stamp
  // branded them incomplete forever.
  it('does not flag an uncertified diver who filled everything else in', async () => {
    from.mockReturnValueOnce(mockQueryBuilder({
      data: [{
        id: 'u3', name: 'Nia', created_at: '2026-04-30T00:00:00Z', status: 'pending',
        application_submitted_at: null,
        date_of_birth: '1990-01-01', nationality: 'JP', gender: 'female',
        contact_method: 'line', contact_id: 'nia-line', cert_level: null, uncertified: true,
      }],
    }))
    renderPage()
    expect(await screen.findByText('Nia')).toBeInTheDocument()
    expect(screen.queryByText(/profile incomplete/i)).not.toBeInTheDocument()
  })

  // Regression: the contact handle was hard-labelled "Email", so a diver who
  // picked Line saw their Line ID filed under Email — and their real address
  // was nowhere on the card.
  it('labels the contact handle with the method the diver picked', async () => {
    from.mockReturnValueOnce(mockQueryBuilder({
      data: [{
        id: 'u1', name: 'Alice', created_at: '2026-04-30T00:00:00Z', status: 'pending',
        contact_method: 'line', contact_id: 'alice-line-id', email: 'alice@example.com',
      }],
    }))
    from.mockReturnValueOnce(mockQueryBuilder({ data: [] }))

    renderPage()
    fireEvent.click(await screen.findByText('Alice'))

    expect(await screen.findByText('Line')).toBeInTheDocument()
    expect(screen.getByText('alice-line-id')).toBeInTheDocument()
    // …and the account email is its own row, whatever the preferred method.
    expect(screen.getByText(/account email/i)).toBeInTheDocument()
    // Twice: the collapsed row leads with it, the summary labels it.
    expect(screen.getAllByText('alice@example.com')).toHaveLength(2)
  })

  it('falls back to a generic contact label when no method is set yet', async () => {
    from.mockReturnValueOnce(mockQueryBuilder({
      data: [{
        id: 'u1', name: 'Leo', created_at: '2026-04-30T00:00:00Z', status: 'pending',
        contact_method: null, contact_id: null, email: 'leo@example.com',
      }],
    }))
    from.mockReturnValueOnce(mockQueryBuilder({ data: [] }))

    renderPage()
    fireEvent.click(await screen.findByText('Leo'))

    // Exact match: the "still missing" line mentions the same words.
    expect(await screen.findByText('Preferred contact')).toBeInTheDocument()
    expect(screen.getAllByText('leo@example.com')).toHaveLength(2)
  })

  it('reinstating calls notify-application-decision and removes the row', async () => {
    from.mockReturnValueOnce(mockQueryBuilder({
      data: [{ id: 'u1', name: 'Alice', created_at: '2026-04-30T00:00:00Z', status: 'pending' }],
    }))
    // Second from() call when user expands to look up first booking
    from.mockReturnValueOnce(mockQueryBuilder({ data: [] }))
    invoke.mockResolvedValue({ data: { ok: true, status: 'active', email_sent: true }, error: null })

    renderPage()
    fireEvent.click(await screen.findByText('Alice'))

    fireEvent.click(await screen.findByRole('button', { name: ap.approve }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'notify-application-decision',
      { body: { user_id: 'u1', decision: 'approve' } },
    ))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(toastSuccess.mock.calls[0][0]).toContain(ap.approved)
    expect(toastSuccess.mock.calls[0][0]).toMatch(/email sent/i)
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })

  it('closing an account sends the typed reason in the body', async () => {
    from.mockReturnValueOnce(mockQueryBuilder({
      data: [{ id: 'u1', name: 'Alice', created_at: '2026-04-30T00:00:00Z', status: 'pending' }],
    }))
    from.mockReturnValueOnce(mockQueryBuilder({ data: [] }))
    invoke.mockResolvedValue({ data: { ok: true, status: 'rejected', email_sent: true }, error: null })

    renderPage()
    fireEvent.click(await screen.findByText('Alice'))

    fireEvent.change(
      await screen.findByPlaceholderText(ap.rejectReasonPlaceholder),
      { target: { value: 'incomplete profile' } },
    )
    fireEvent.click(screen.getByRole('button', { name: ap.reject }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'notify-application-decision',
      { body: { user_id: 'u1', decision: 'reject', reason: 'incomplete profile' } },
    ))
  })

  // Regression: the query was `.eq('status', 'pending')`, so closing an account
  // dropped it off the only screen that can reopen it. Admins read that as a
  // delete and went to Create diver, which fails — closing never touched
  // auth.users, so the email is still taken.
  it('lists closed accounts in their own section, reinstate-only', async () => {
    from.mockReturnValueOnce(mockQueryBuilder({
      data: [
        { id: 'u1', name: 'Alice', created_at: '2026-04-30T00:00:00Z', status: 'pending' },
        { id: 'u2', name: 'Bob', email: 'bob@example.com', created_at: '2026-04-20T00:00:00Z', status: 'rejected' },
      ],
    }))
    from.mockReturnValueOnce(mockQueryBuilder({ data: [] }))
    renderPage()

    expect(await screen.findByText(ap.closedHeading)).toBeInTheDocument()
    expect(screen.getByText(ap.closedCount(1))).toBeInTheDocument()
    // The count in the header stays the on-hold one, matching the hub badge.
    expect(screen.getByText(ap.pendingCount(1))).toBeInTheDocument()
    // The address is on the collapsed row: half these rows never got a name.
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Bob'))
    expect(await screen.findByRole('button', { name: ap.approve })).toBeInTheDocument()
    // A closed account has nowhere further to go, so no Close and no reason box.
    expect(screen.queryByRole('button', { name: ap.reject })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(ap.rejectReasonPlaceholder)).not.toBeInTheDocument()
  })

  it('reinstates a closed account through the same decision endpoint', async () => {
    from.mockReturnValueOnce(mockQueryBuilder({
      data: [{ id: 'u2', name: 'Bob', created_at: '2026-04-20T00:00:00Z', status: 'rejected' }],
    }))
    from.mockReturnValueOnce(mockQueryBuilder({ data: [] }))
    invoke.mockResolvedValue({ data: { ok: true, status: 'active', email_sent: true }, error: null })

    renderPage()
    fireEvent.click(await screen.findByText('Bob'))
    fireEvent.click(await screen.findByRole('button', { name: ap.approve }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'notify-application-decision',
      { body: { user_id: 'u2', decision: 'approve' } },
    ))
    await waitFor(() => expect(screen.queryByText('Bob')).not.toBeInTheDocument())
    expect(screen.getByText(ap.noneClosed)).toBeInTheDocument()
  })

  it('shows both empty states when nothing is suspended', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: [] }))
    renderPage()
    expect(await screen.findByText(ap.none)).toBeInTheDocument()
    expect(screen.getByText(ap.noneClosed)).toBeInTheDocument()
  })

  it('shows an error toast when the function call fails', async () => {
    from.mockReturnValueOnce(mockQueryBuilder({
      data: [{ id: 'u1', name: 'Alice', created_at: '2026-04-30T00:00:00Z', status: 'pending' }],
    }))
    from.mockReturnValueOnce(mockQueryBuilder({ data: [] }))
    invoke.mockResolvedValue({ data: null, error: { message: 'forbidden' } })

    renderPage()
    fireEvent.click(await screen.findByText('Alice'))
    fireEvent.click(await screen.findByRole('button', { name: ap.approve }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError.mock.calls[0][0]).toMatch(/forbidden/i)
    // Row stays — only successful decisions remove it.
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })
})
