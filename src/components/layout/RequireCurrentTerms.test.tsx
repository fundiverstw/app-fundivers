import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RequireCurrentTerms } from './RequireCurrentTerms'
import { CURRENT_TERMS_VERSION } from '../../lib/terms-version'

const useAuthMock = vi.fn()
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

beforeEach(() => { useAuthMock.mockReset() })

function routedRender(startAt = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[startAt]}>
      <Routes>
        <Route path="/terms" element={<div>TERMS-PAGE</div>} />
        <Route element={<RequireCurrentTerms />}>
          <Route path="/dashboard" element={<div>DASHBOARD</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('RequireCurrentTerms', () => {
  it('shows spinner while loading', () => {
    useAuthMock.mockReturnValue({ profile: null, loading: true })
    const { container } = routedRender()
    expect(container.querySelector('.animate-spin')).toBeTruthy()
  })

  it('passes through when profile is null (logged out / not yet loaded)', () => {
    useAuthMock.mockReturnValue({ profile: null, loading: false })
    routedRender()
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument()
  })

  it('passes through when version is current', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', agreed_to_terms_version: CURRENT_TERMS_VERSION },
      loading: false,
    })
    routedRender()
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument()
  })

  it('passes through when version is higher than current (user agreed to more than required)', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', agreed_to_terms_version: CURRENT_TERMS_VERSION + 5 },
      loading: false,
    })
    routedRender()
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument()
  })

  it('bounces to /terms when version is stale', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', agreed_to_terms_version: CURRENT_TERMS_VERSION - 1 },
      loading: false,
    })
    routedRender()
    expect(screen.getByText('TERMS-PAGE')).toBeInTheDocument()
    expect(screen.queryByText('DASHBOARD')).not.toBeInTheDocument()
  })

  it('bounces to /terms when version is null (never consented)', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', agreed_to_terms_version: null },
      loading: false,
    })
    routedRender()
    expect(screen.getByText('TERMS-PAGE')).toBeInTheDocument()
  })

  it('does NOT trap a stale user on /terms (must allow re-acceptance UI to render)', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', agreed_to_terms_version: 0 },
      loading: false,
    })
    render(
      <MemoryRouter initialEntries={['/terms']}>
        <Routes>
          <Route element={<RequireCurrentTerms />}>
            <Route path="/terms" element={<div>TERMS-PAGE</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('TERMS-PAGE')).toBeInTheDocument()
  })
})
