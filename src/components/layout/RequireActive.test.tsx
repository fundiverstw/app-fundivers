import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RequireActive } from './RequireActive'

const useAuthMock = vi.fn()
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

beforeEach(() => { useAuthMock.mockReset() })

function routedRender(startAt = '/calendar') {
  return render(
    <MemoryRouter initialEntries={[startAt]}>
      <Routes>
        <Route path="/login"   element={<div>LOGIN</div>} />
        <Route path="/pending" element={<div>PENDING</div>} />
        <Route element={<RequireActive />}>
          <Route path="/calendar" element={<div>CALENDAR</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('RequireActive', () => {
  it('shows spinner while loading', () => {
    useAuthMock.mockReturnValue({ session: null, profile: null, loading: true })
    const { container } = routedRender()
    expect(container.querySelector('.animate-spin')).toBeTruthy()
  })

  it('bounces unauthenticated callers to /login', () => {
    useAuthMock.mockReturnValue({ session: null, profile: null, loading: false })
    routedRender()
    expect(screen.getByText('LOGIN')).toBeInTheDocument()
  })

  it('lets active divers through', () => {
    useAuthMock.mockReturnValue({
      session: { user: { id: 'u1' } },
      profile: { id: 'u1', role: 'diver', status: 'active' },
      loading: false,
    })
    routedRender()
    expect(screen.getByText('CALENDAR')).toBeInTheDocument()
  })

  it('bounces pending divers to /pending', () => {
    useAuthMock.mockReturnValue({
      session: { user: { id: 'u1' } },
      profile: { id: 'u1', role: 'diver', status: 'pending' },
      loading: false,
    })
    routedRender()
    expect(screen.getByText('PENDING')).toBeInTheDocument()
    expect(screen.queryByText('CALENDAR')).not.toBeInTheDocument()
  })

  it('bounces rejected divers to /pending', () => {
    useAuthMock.mockReturnValue({
      session: { user: { id: 'u1' } },
      profile: { id: 'u1', role: 'diver', status: 'rejected' },
      loading: false,
    })
    routedRender()
    expect(screen.getByText('PENDING')).toBeInTheDocument()
  })

  it('lets admins through regardless of status', () => {
    useAuthMock.mockReturnValue({
      session: { user: { id: 'a1' } },
      profile: { id: 'a1', role: 'admin', status: 'pending' },
      loading: false,
    })
    routedRender()
    expect(screen.getByText('CALENDAR')).toBeInTheDocument()
  })

  it('lets staff through regardless of status', () => {
    useAuthMock.mockReturnValue({
      session: { user: { id: 's1' } },
      profile: { id: 's1', role: 'staff', status: 'pending' },
      loading: false,
    })
    routedRender()
    expect(screen.getByText('CALENDAR')).toBeInTheDocument()
  })
})
