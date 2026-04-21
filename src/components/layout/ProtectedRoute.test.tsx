import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'

const useAuthMock = vi.fn()
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

beforeEach(() => { useAuthMock.mockReset() })

function routedRender(startAt = '/private') {
  return render(
    <MemoryRouter initialEntries={[startAt]}>
      <Routes>
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/private" element={<div>PRIVATE_CONTENT</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('ProtectedRoute', () => {
  it('shows the loading spinner while useAuth is loading', () => {
    useAuthMock.mockReturnValue({ session: null, loading: true })
    const { container } = routedRender()
    expect(container.querySelector('.animate-spin')).toBeTruthy()
    expect(screen.queryByText('PRIVATE_CONTENT')).not.toBeInTheDocument()
    expect(screen.queryByText('LOGIN_PAGE')).not.toBeInTheDocument()
  })

  it('redirects to /login when not authenticated', () => {
    useAuthMock.mockReturnValue({ session: null, loading: false })
    routedRender()
    expect(screen.getByText('LOGIN_PAGE')).toBeInTheDocument()
    expect(screen.queryByText('PRIVATE_CONTENT')).not.toBeInTheDocument()
  })

  it('renders the outlet when authenticated', () => {
    useAuthMock.mockReturnValue({ session: { user: { id: 'u1' } }, loading: false })
    routedRender()
    expect(screen.getByText('PRIVATE_CONTENT')).toBeInTheDocument()
  })
})
