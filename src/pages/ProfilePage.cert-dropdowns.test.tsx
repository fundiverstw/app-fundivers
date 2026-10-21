import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfilePage } from './ProfilePage'
import { renderWithRouter, mockQueryBuilder } from '../../tests/test-utils'

const { from, update, useAuthMock } = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  useAuthMock: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

beforeEach(() => {
  from.mockReset()
  update.mockReset()
  useAuthMock.mockReset()
})

const LADDER = [
  { id: '1', code: 'open_water', organization: 'PADI', name: 'OW', rank: 1 },
  { id: '2', code: 'advanced_open_water', organization: 'PADI', name: 'AOW', rank: 2 },
  { id: '3', code: 'rescue', organization: 'PADI', name: 'Rescue', rank: 3 },
  { id: '4', code: 'ssi_open_water', organization: 'SSI', name: 'Open Water Diver', rank: 1 },
  { id: '5', code: 'ssi_advanced_open_water', organization: 'SSI', name: 'Advanced Open Water Diver', rank: 2 },
]

const baseProfile = {
  id: 'u1',
  name: 'Ada',
  date_of_birth: '1815-12-10',
  contact_method: 'email',
  contact_id: 'ada@example.com',
  cert_card_path: 'u1/card.jpg',
  logged_dives: 124,
}

describe('ProfilePage cert dropdowns', () => {
  it('shows the saved level, selected by its cert_levels code', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: { ...baseProfile, cert_agency: 'PADI', cert_level: 'Rescue', cert_level_code: 'rescue' },
    })
    from.mockReturnValue(mockQueryBuilder({ data: LADDER }))
    renderWithRouter(<ProfilePage />)
    await screen.findByRole('button', { name: /save changes/i })

    await waitFor(() => expect((screen.getByLabelText('Agency') as HTMLSelectElement).value).toBe('PADI'))
    await waitFor(() => expect((screen.getByLabelText('Level') as HTMLSelectElement).value).toBe('rescue'))
    expect(screen.queryByText(/isn’t on our list/i)).not.toBeInTheDocument()
  })

  // A value the migration's backfill couldn't place keeps its text and has no
  // code. There is no option to select, so the diver is told what to replace.
  it('asks the diver to pick again when the saved certification is legacy text', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: { ...baseProfile, cert_agency: 'PSAI', cert_level: 'PE40', cert_level_code: null },
    })
    from.mockReturnValue(mockQueryBuilder({ data: LADDER }))
    renderWithRouter(<ProfilePage />)
    await screen.findByRole('button', { name: /save changes/i })

    await waitFor(() => expect(screen.getByRole('option', { name: 'SSI' })).toBeInTheDocument())
    expect((screen.getByLabelText('Agency') as HTMLSelectElement).value).toBe('')
    expect(screen.getByText('The saved certification “PSAI PE40” isn’t on our list. Pick the matching agency and level.')).toBeInTheDocument()
  })

  it('saves the picked level as its code, and changing agency clears the level', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: { ...baseProfile, cert_agency: 'PADI', cert_level: 'OW', cert_level_code: 'open_water' },
    })
    from.mockReturnValue({
      ...mockQueryBuilder({ data: LADDER }),
      update: (...a: unknown[]) => { update(...a); return mockQueryBuilder() },
    })
    const user = userEvent.setup()
    renderWithRouter(<ProfilePage />)
    await screen.findByRole('button', { name: /save changes/i })
    await waitFor(() => expect(screen.getByRole('option', { name: 'SSI' })).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('Agency'), 'SSI')
    expect((screen.getByLabelText('Level') as HTMLSelectElement).value).toBe('')
    await user.selectOptions(screen.getByLabelText('Level'), 'ssi_advanced_open_water')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    const payload = update.mock.calls[0][0] as Record<string, unknown>
    expect(payload.cert_level_code).toBe('ssi_advanced_open_water')
    expect(payload).not.toHaveProperty('cert_level')
    expect(payload).not.toHaveProperty('cert_agency')
  })

  it('renders the Deep card upload section when deep_certified is true on the loaded profile', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: {
        id: 'u1',
        name: 'Ada',
        date_of_birth: '1815-12-10',
        contact_method: 'email',
        contact_id: 'ada@example.com',
        cert_agency: 'PADI',
        cert_level: 'Rescue',
        cert_level_code: 'rescue',
        cert_card_path: 'u1/card.jpg',
        deep_certified: true,
        deep_card_path: 'u1/deep.jpg',
        logged_dives: 124,
      },
    })
    from.mockReturnValue(mockQueryBuilder({ data: [] }))
    renderWithRouter(<ProfilePage />)

    await screen.findByRole('button', { name: /save changes/i })
    expect(screen.queryByText(/Deep card photo|Choose photo/i)).not.toBeNull()
  })
})
