import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HomeRedirect } from './HomeRedirect'

const useAuthMock = vi.fn()
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))

beforeEach(() => useAuthMock.mockReset())

function routedRender(start = '/') {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/calendar" element={<div>DIVER-CAL</div>} />
        <Route path="/admin/events" element={<div>ADMIN-CAL</div>} />
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('HomeRedirect', () => {
  it('admin lands on /admin/events', async () => {
    useAuthMock.mockReturnValue({ profile: { role: 'admin' }, loading: false })
    routedRender()
    expect(await screen.findByText('ADMIN-CAL')).toBeInTheDocument()
  })

  it('staff lands on /calendar (only admin gets the admin shell by default)', async () => {
    useAuthMock.mockReturnValue({ profile: { role: 'staff' }, loading: false })
    routedRender()
    expect(await screen.findByText('DIVER-CAL')).toBeInTheDocument()
  })

  it('diver lands on /calendar', async () => {
    useAuthMock.mockReturnValue({ profile: { role: 'diver' }, loading: false })
    routedRender()
    expect(await screen.findByText('DIVER-CAL')).toBeInTheDocument()
  })

  it('unauthenticated viewer falls through to /calendar (ProtectedRoute will then bounce to /login)', async () => {
    useAuthMock.mockReturnValue({ profile: null, loading: false })
    routedRender()
    expect(await screen.findByText('DIVER-CAL')).toBeInTheDocument()
  })

  it('shows a loader while profile is still resolving', () => {
    useAuthMock.mockReturnValue({ profile: null, loading: true })
    routedRender()
    expect(screen.queryByText('ADMIN-CAL')).not.toBeInTheDocument()
    expect(screen.queryByText('DIVER-CAL')).not.toBeInTheDocument()
  })
})
