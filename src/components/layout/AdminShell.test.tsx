import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AdminShell } from './AdminShell'

const { useAuthMock, from } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  from:        vi.fn(),
}))

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

beforeEach(() => {
  useAuthMock.mockReset()
  from.mockReset()
})

function buildPendingCountQuery(count: number) {
  return {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    neq:    vi.fn().mockReturnThis(),
    not:    vi.fn().mockReturnThis(),
    then:   (resolve: (r: { count: number }) => void) => resolve({ count }),
  }
}

function routedRender(start = '/admin') {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route element={<AdminShell />}>
          <Route path="/admin" element={<div>HOME</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('AdminShell pending badge', () => {
  it('shows pending count for admin when > 0', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'a1', role: 'admin', nickname: 'Ada' },
      signOut: vi.fn(),
    })
    from.mockReturnValue(buildPendingCountQuery(3))
    routedRender()
    await waitFor(() => expect(screen.getByText(/3 pending/i)).toBeInTheDocument())
  })

  it('hides badge when count is 0', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'a1', role: 'admin', nickname: 'Ada' },
      signOut: vi.fn(),
    })
    from.mockReturnValue(buildPendingCountQuery(0))
    routedRender()
    // Wait one tick so the async query result lands.
    await new Promise(r => setTimeout(r, 0))
    expect(screen.queryByText(/pending/i)).not.toBeInTheDocument()
  })

  it('shows a refund-requests badge linking to /admin/refunds', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'a1', role: 'admin', nickname: 'Ada' },
      signOut: vi.fn(),
    })
    // Distinct counts per table: no pending applications, two open refunds.
    from.mockImplementation((table: string) =>
      buildPendingCountQuery(table === 'bookings' ? 2 : 0))
    routedRender()
    const badge = await screen.findByText(/2 refunds/i)
    expect(badge.closest('a')).toHaveAttribute('href', '/admin/refunds')
  })

  // Regression: the badge counted only profiles with a non-null
  // application_submitted_at. That column is stamped by a DB trigger and never
  // lands for a diver who stopped short of completing their profile, so the
  // badge showed nothing while divers sat waiting — the same defect that hid
  // them from the approvals queue itself.
  it('counts every pending diver, including ones with an unfinished profile', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'a1', role: 'admin', nickname: 'Ada' },
      signOut: vi.fn(),
    })
    const calls: Array<{ method: string; args: unknown[] }> = []
    from.mockImplementation((table: string) => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'neq', 'not', 'is']) {
        q[m] = (...args: unknown[]) => {
          if (table === 'profiles') calls.push({ method: m, args })
          return q
        }
      }
      // 4 pending divers, none of whom ever earned the timestamp.
      q.then = (resolve: (r: { count: number }) => void) => resolve({ count: table === 'profiles' ? 4 : 0 })
      return q
    })

    routedRender()

    await waitFor(() => expect(screen.getByText(/4 pending/i)).toBeInTheDocument())
    // Nothing may narrow the count beyond status='pending'.
    expect(calls.some(c => c.args.includes('application_submitted_at'))).toBe(false)
    expect(calls.filter(c => c.method === 'eq')).toEqual([
      { method: 'eq', args: ['status', 'pending'] },
    ])
  })

  it('does not query for staff users', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 's1', role: 'staff', nickname: 'Sam' },
      signOut: vi.fn(),
    })
    routedRender()
    await new Promise(r => setTimeout(r, 0))
    expect(from).not.toHaveBeenCalled()
    expect(screen.queryByText(/pending/i)).not.toBeInTheDocument()
  })

  it('shows the Logistics tab to staff (and admins)', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 's1', role: 'staff', nickname: 'Sam' },
      signOut: vi.fn(),
    })
    routedRender()
    expect(screen.getByRole('link', { name: 'Logistics' })).toBeInTheDocument()
    // Admin-only tabs stay hidden for staff.
    expect(screen.queryByRole('link', { name: 'Divers' })).not.toBeInTheDocument()
  })
})
