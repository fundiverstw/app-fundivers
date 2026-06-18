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
