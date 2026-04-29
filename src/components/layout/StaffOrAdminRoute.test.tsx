import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { StaffOrAdminRoute } from './StaffOrAdminRoute'

const useAuthMock = vi.fn()
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

beforeEach(() => { useAuthMock.mockReset() })

function routedRender(startAt = '/admin/events') {
  return render(
    <MemoryRouter initialEntries={[startAt]}>
      <Routes>
        <Route path="/login" element={<div>LOGIN</div>} />
        <Route path="/calendar" element={<div>CALENDAR</div>} />
        <Route element={<StaffOrAdminRoute />}>
          <Route path="/admin/events" element={<div>EVENTS_AREA</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('StaffOrAdminRoute', () => {
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
    expect(screen.queryByText('EVENTS_AREA')).not.toBeInTheDocument()
  })

  it('lets admins through', () => {
    useAuthMock.mockReturnValue({
      session: { user: { id: 'u1' } },
      profile: { id: 'u1', role: 'admin' },
      loading: false,
    })
    routedRender()
    expect(screen.getByText('EVENTS_AREA')).toBeInTheDocument()
  })

  it('lets staff through', () => {
    useAuthMock.mockReturnValue({
      session: { user: { id: 'u1' } },
      profile: { id: 'u1', role: 'staff' },
      loading: false,
    })
    routedRender()
    expect(screen.getByText('EVENTS_AREA')).toBeInTheDocument()
  })
})
