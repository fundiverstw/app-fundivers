import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RequireCurrentTerms } from './RequireCurrentTerms'

// The live terms version comes from the DB now, so the guard's dependency is a
// hook, not a constant. `LIVE_VERSION` stands in for whatever the shop published.
const LIVE_VERSION = 3
const useTermsMock = vi.fn()
vi.mock('../../lib/use-terms', () => ({
  useTerms: () => useTermsMock(),
}))

const useAuthMock = vi.fn()
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

beforeEach(() => {
  useAuthMock.mockReset()
  useTermsMock.mockReset()
  useTermsMock.mockReturnValue({ terms: { title: 'T', body: '', version: LIVE_VERSION }, loading: false })
})

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
      profile: { id: 'u1', agreed_to_terms_version: LIVE_VERSION },
      loading: false,
    })
    routedRender()
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument()
  })

  it('passes through when version is higher than current (user agreed to more than required)', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', agreed_to_terms_version: LIVE_VERSION + 5 },
      loading: false,
    })
    routedRender()
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument()
  })

  it('bounces to /terms when version is stale', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', agreed_to_terms_version: LIVE_VERSION - 1 },
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
  // A hiccup reading one DB row must not lock every diver out of the whole app.
  it('fails open when the terms version is unknown (still loading or read failed)', () => {
    useAuthMock.mockReturnValue({ profile: { id: 'u1', agreed_to_terms_version: 0 }, loading: false })
    useTermsMock.mockReturnValue({ terms: null, loading: false })
    routedRender()
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument()
  })
})
