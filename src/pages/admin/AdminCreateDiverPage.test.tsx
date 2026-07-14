import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminCreateDiverPage } from './AdminCreateDiverPage'
import { mockQueryBuilder } from '../../../tests/test-utils'
import { t } from '../../i18n'
import type { Profile } from '../../types/database'

const { invoke, from, useAuthMock } = vi.hoisted(() => ({
  invoke: vi.fn(),
  from: vi.fn(),
  useAuthMock: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => from(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

// Stub the heavy ProfileForm (it fetches cert levels + renders card-upload
// sections). We only assert it's rendered against the newly-created profile.
vi.mock('../ProfilePage', () => ({
  ProfileForm: ({ profile }: { profile: Profile }) => (
    <div data-testid="profile-form">editing:{profile.id}</div>
  ),
}))

const cd = t.admin.createDiver
const pf = t.profile.family

const newProfile = { id: 'd1', name: 'Jane Diver', nickname: null } as unknown as Profile

beforeEach(() => {
  invoke.mockReset()
  from.mockReset()
  useAuthMock.mockReturnValue({ user: { id: 'admin1' } })
})

describe('AdminCreateDiverPage', () => {
  it('creates the account then shows the details form and next-step links', async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, user_id: 'd1', email_sent: true }, error: null })
    from.mockImplementation(() => mockQueryBuilder({ data: newProfile }))

    const user = userEvent.setup()
    render(<MemoryRouter><AdminCreateDiverPage /></MemoryRouter>)

    await user.type(screen.getByLabelText(pf.emailLabel, { exact: false }), 'jane@example.com')
    await user.type(screen.getByLabelText(pf.nameLabel, { exact: false }), 'Jane Diver')
    await user.click(screen.getByRole('button', { name: pf.createSubmit }))

    await waitFor(() => expect(screen.getByTestId('profile-form')).toBeInTheDocument())

    // Edge function was called with the normalized email + name.
    const [fn, opts] = invoke.mock.calls[0]
    expect(fn).toBe('admin-create-diver')
    expect((opts as { body: { email: string; name: string } }).body).toMatchObject({
      email: 'jane@example.com',
      name: 'Jane Diver',
    })

    // The details form targets the new diver, and the next-step links resolve.
    expect(screen.getByTestId('profile-form')).toHaveTextContent('editing:d1')
    expect(screen.getByRole('link', { name: cd.registerForEvent })).toHaveAttribute('href', '/admin/events?diver=d1')
    expect(screen.getByRole('link', { name: cd.openInDirectory })).toHaveAttribute('href', '/admin/users?diver=d1')
  })

  it('rejects a blank name before invoking the edge function', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><AdminCreateDiverPage /></MemoryRouter>)

    // A whitespace-only name passes the native `required` check but the handler
    // trims it away — the JS guard must catch it and never hit the backend.
    await user.type(screen.getByLabelText(pf.emailLabel, { exact: false }), 'jane@example.com')
    await user.type(screen.getByLabelText(pf.nameLabel, { exact: false }), '   ')
    await user.click(screen.getByRole('button', { name: pf.createSubmit }))

    expect(screen.getByText(pf.emailNameRequired)).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalled()
  })
})
