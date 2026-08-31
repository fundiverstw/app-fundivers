import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import { WelcomeModal } from './WelcomeModal'
import { t } from '../../i18n'

const { updateUser } = vi.hoisted(() => ({ updateUser: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { updateUser: (...a: unknown[]) => updateUser(...a) } },
}))

beforeEach(() => {
  updateUser.mockReset()
  updateUser.mockResolvedValue({ error: null })
})

const user = (meta: Record<string, unknown> = {}) =>
  ({ id: 'u1', user_metadata: meta } as unknown as User)

function renderModal(u: User = user({ name: 'Ada Lovelace' }), onDismiss = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/calendar']}>
      <Routes>
        <Route path="/calendar" element={<WelcomeModal user={u} onDismiss={onDismiss} />} />
        <Route path="/profile" element={<div>PROFILE_PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
  return onDismiss
}

describe('WelcomeModal', () => {
  it('greets the diver by first name', () => {
    renderModal()
    expect(screen.getByRole('heading', { name: t.welcome.greeting('Ada') })).toBeInTheDocument()
  })

  it('greets a diver with no name on record without an empty comma', () => {
    renderModal(user({}))
    expect(screen.getByRole('heading', { name: t.welcome.greeting('') })).toBeInTheDocument()
  })

  // The whole point of the modal: a brand-new account carries almost nothing
  // the shop needs, and nothing anywhere forces that gap closed.
  it('names filling out the profile as the first thing to do', () => {
    renderModal()
    expect(screen.getByText(t.welcome.firstStep)).toBeInTheDocument()
    expect(screen.getByText(t.welcome.profileNoRush)).toBeInTheDocument()
  })

  it('takes the diver straight to the profile, and remembers it was shown', async () => {
    const u = userEvent.setup()
    const onDismiss = renderModal()

    await u.click(screen.getByRole('button', { name: t.welcome.fillProfile }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledOnce())
    const stamped = updateUser.mock.calls[0][0] as { data: { welcomed_at: string } }
    expect(typeof stamped.data.welcomed_at).toBe('string')
    expect(onDismiss).toHaveBeenCalled()
    expect(await screen.findByText('PROFILE_PAGE')).toBeInTheDocument()
  })

  // Not a wall. A diver who wants to look at the calendar first is not doing
  // anything wrong, and "Later" must not leave the modal waiting to reappear.
  it('lets the diver defer, and still does not show again', async () => {
    const u = userEvent.setup()
    const onDismiss = renderModal()

    await u.click(screen.getByRole('button', { name: t.welcome.later }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledOnce())
    expect(onDismiss).toHaveBeenCalled()
    expect(screen.queryByText('PROFILE_PAGE')).not.toBeInTheDocument()
  })

  it('is a modal dialog', () => {
    renderModal()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })
})
