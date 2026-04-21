import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfilePage } from './ProfilePage'
import { renderWithRouter, mockQueryBuilder } from '../../tests/test-utils'

const { upsert, from, useAuthMock } = vi.hoisted(() => ({
  upsert: vi.fn(),
  from: vi.fn(),
  useAuthMock: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

function input(name: string): HTMLInputElement | HTMLTextAreaElement {
  const el = document.querySelector(`[name="${name}"]`)
  if (!el) throw new Error(`no form control with name=${name}`)
  return el as HTMLInputElement
}

beforeEach(() => {
  upsert.mockReset()
  from.mockReset()
  useAuthMock.mockReset()
})

describe('ProfilePage', () => {
  it('shows required error when full name is cleared and submitted', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: { id: 'u1', full_name: 'Ada Lovelace' },
    })
    from.mockReturnValue({
      ...mockQueryBuilder(),
      upsert: (...a: unknown[]) => { upsert(...a); return mockQueryBuilder() },
    })
    const user = userEvent.setup()
    renderWithRouter(<ProfilePage />)

    await waitFor(() => expect((input('full_name') as HTMLInputElement).value).toBe('Ada Lovelace'))

    await user.clear(input('full_name'))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText(/required/i)).toBeInTheDocument()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('submit is disabled when the form is clean', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: { id: 'u1', full_name: 'Ada' },
    })
    from.mockReturnValue(mockQueryBuilder())
    renderWithRouter(<ProfilePage />)
    const btn = await screen.findByRole('button', { name: /save changes/i })
    await waitFor(() => expect(btn).toBeDisabled())
  })

  it('upserts with user.id, form values and updated_at on submit', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: { id: 'u1', full_name: 'Ada' },
    })
    from.mockImplementation(() => ({
      ...mockQueryBuilder(),
      upsert: (...a: unknown[]) => { upsert(...a); return mockQueryBuilder() },
    }))

    const user = userEvent.setup()
    renderWithRouter(<ProfilePage />)
    await waitFor(() => expect((input('full_name') as HTMLInputElement).value).toBe('Ada'))

    await user.clear(input('full_name'))
    await user.type(input('full_name'), 'Ada L.')
    await user.type(input('phone'), '+886-900-123')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(upsert).toHaveBeenCalledOnce())
    const payload = upsert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.id).toBe('u1')
    expect(payload.full_name).toBe('Ada L.')
    expect(payload.phone).toBe('+886-900-123')
    expect(typeof payload.updated_at).toBe('string')
    expect(new Date(payload.updated_at as string).toString()).not.toBe('Invalid Date')
    expect(from).toHaveBeenCalledWith('profiles')
  })

  it('no-ops submit when there is no authenticated user', async () => {
    useAuthMock.mockReturnValue({ user: null, profile: null })
    from.mockReturnValue({
      ...mockQueryBuilder(),
      upsert: (...a: unknown[]) => { upsert(...a); return mockQueryBuilder() },
    })
    const user = userEvent.setup()
    renderWithRouter(<ProfilePage />)
    // Trigger dirty state then submit
    await user.type(input('full_name'), 'Ada')
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    expect(upsert).not.toHaveBeenCalled()
  })
})
