import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AdminRoute } from './AdminRoute'

const useAuthMock = vi.fn()
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

beforeEach(() => { useAuthMock.mockReset() })

function routedRender(startAt = '/admin') {
  return render(
    <MemoryRouter initialEntries={[startAt]}>
      <Routes>
        <Route path="/login" element={<div>LOGIN</div>} />
        <Route path="/calendar" element={<div>CALENDAR</div>} />
        <Route element={<AdminRoute />}>
          <Route path="/admin" element={<div>ADMIN_AREA</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('AdminRoute', () => {
  it('shows loading spinner while session/profile load', () => {
    useAuthMock.mockReturnValue({ session: null, profile: null, loading: true })
    const { container } = routedRender()
    expect(container.querySelector('.animate-spin')).toBeTruthy()
  })

  it('redirects unauthenticated users to /login', () => {
    useAuthMock.mockReturnValue({ session: null, profile: null, loading: false })
    routedRender()
    expect(screen.getByText('LOGIN')).toBeInTheDocument()
  })

  it('redirects divers to /calendar', () => {
    useAuthMock.mockReturnValue({
      session: { user: { id: 'u1' } },
      profile: { id: 'u1', role: 'diver' },
      loading: false,
    })
    routedRender()
    expect(screen.getByText('CALENDAR')).toBeInTheDocument()
    expect(screen.queryByText('ADMIN_AREA')).not.toBeInTheDocument()
  })

  it('lets admins through', () => {
    useAuthMock.mockReturnValue({
      session: { user: { id: 'u1' } },
      profile: { id: 'u1', role: 'admin' },
      loading: false,
    })
    routedRender()
    expect(screen.getByText('ADMIN_AREA')).toBeInTheDocument()
  })
})
