import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FamilySection } from './FamilySection'
import { mockQueryBuilder } from '../../../tests/test-utils'
import type { Profile } from '../../types/database'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

// Stub the heavy ProfileForm (it fetches cert levels + renders card-upload
// sections). We only need to assert it's rendered for the right child and
// that onSaved collapses the editor.
vi.mock('../../pages/ProfilePage', () => ({
  ProfileForm: ({ profile, onSaved }: { profile: Profile; onSaved?: () => void }) => (
    <div data-testid="profile-form">
      <span>editing:{profile.id}</span>
      <button type="button" onClick={() => onSaved?.()}>stub-save</button>
    </div>
  ),
}))

const parent = { id: 'p1', parent_account: null, status: 'active' } as unknown as Profile

function childRow(over: Partial<Profile>): Profile {
  return {
    id: 'c1', parent_account: 'p1', status: 'active',
    name: 'Kid One', nickname: null, cert_agency: null, cert_level: null,
    ...over,
  } as unknown as Profile
}

beforeEach(() => from.mockReset())

describe('FamilySection per-child editor', () => {
  it('toggles the full ProfileForm for a child and collapses it on save', async () => {
    from.mockImplementation(() => mockQueryBuilder({ data: [childRow({ id: 'c1', name: 'Kid One' })] }))

    const user = userEvent.setup()
    render(<FamilySection parent={parent} />)

    await screen.findByText('Kid One')
    expect(screen.queryByTestId('profile-form')).not.toBeInTheDocument()

    // Open the editor for the child.
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    expect(screen.getByTestId('profile-form')).toHaveTextContent('editing:c1')

    // Saving collapses it again.
    await user.click(screen.getByRole('button', { name: /stub-save/i }))
    await waitFor(() => expect(screen.queryByTestId('profile-form')).not.toBeInTheDocument())
  })

  it('renders nothing for a child account (only top-level divers are parents)', () => {
    const { container } = render(
      <FamilySection parent={{ id: 'kid', parent_account: 'p1', status: 'active' } as unknown as Profile} />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
