import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { ProfilePage } from './ProfilePage'
import { renderWithRouter, mockQueryBuilder } from '../../tests/test-utils'

const { from, useAuthMock } = vi.hoisted(() => ({
  from: vi.fn(),
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
  useAuthMock.mockReset()
})

describe('ProfilePage cert dropdown display', () => {
  // Regression: the saved cert_agency and cert_level used to vanish from the
  // dropdowns on mount, even though they were correctly seeded into the
  // form. Cause was unstable React option keys across the cert_levels
  // fetch: the initial render had positional / synthetic keys, the post-
  // fetch render had real DB ids, and the brief absence of an <option>
  // matching the (uncontrolled) select's value dropped the value to "".
  it('displays saved cert_agency in the agency dropdown when cert_levels has matching rows', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: {
        id: 'u1',
        name: 'Ada',
        nickname: 'Ada',
        date_of_birth: '1815-12-10',
        contact_method: 'email',
        contact_id: 'ada@example.com',
        cert_agency: 'PADI',
        cert_level: 'Rescue',
        cert_card_path: 'u1/card.jpg',
        nitrox_certified: true,
        nitrox_card_path: 'u1/nitrox.jpg',
        deep_certified: true,
        deep_card_path: 'u1/deep.jpg',
        logged_dives: 124,
      },
    })
    from.mockReturnValue({
      ...mockQueryBuilder({
        data: [
          { id: '1', organization: 'PADI', name: 'Open Water', rank: 1 },
          { id: '2', organization: 'PADI', name: 'Advanced Open Water', rank: 2 },
          { id: '3', organization: 'PADI', name: 'Rescue', rank: 3 },
        ],
      }),
    })
    renderWithRouter(<ProfilePage />)
    await screen.findByRole('button', { name: /save changes/i })

    const agencySelect = document.querySelector('select[name="cert_agency"]') as HTMLSelectElement
    expect(agencySelect, 'agency select rendered').not.toBeNull()
    await waitFor(() => {
      expect(agencySelect.value).toBe('PADI')
    })

    const levelSelect = document.querySelector('select[name="cert_level"]') as HTMLSelectElement
    expect(levelSelect, 'level select rendered').not.toBeNull()
    await waitFor(() => {
      expect(levelSelect.value).toBe('Rescue')
    })
  })

  it('displays saved cert_agency + cert_level even when neither appears in cert_levels (legacy free-text values like SAA / Dive Leader)', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: {
        id: 'u1',
        name: 'Ada',
        nickname: 'Ada',
        date_of_birth: '1815-12-10',
        contact_method: 'email',
        contact_id: 'ada@example.com',
        cert_agency: 'SAA',
        cert_level: 'Dive Leader (with Diver Rescue)',
        cert_card_path: 'u1/card.jpg',
        logged_dives: 50,
      },
    })
    from.mockReturnValue({
      ...mockQueryBuilder({
        data: [
          { id: '1', organization: 'PADI', name: 'Open Water', rank: 1 },
          { id: '2', organization: 'PADI', name: 'Rescue', rank: 3 },
        ],
      }),
    })
    renderWithRouter(<ProfilePage />)
    await screen.findByRole('button', { name: /save changes/i })

    const agencySelect = document.querySelector('select[name="cert_agency"]') as HTMLSelectElement
    await waitFor(() => {
      expect(agencySelect.value).toBe('SAA')
    })

    const levelSelect = document.querySelector('select[name="cert_level"]') as HTMLSelectElement
    await waitFor(() => {
      expect(levelSelect.value).toBe('Dive Leader (with Diver Rescue)')
    })
  })

  it('renders the Deep card upload section when deep_certified is true on the loaded profile', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: {
        id: 'u1',
        name: 'Ada',
        nickname: 'Ada',
        date_of_birth: '1815-12-10',
        contact_method: 'email',
        contact_id: 'ada@example.com',
        cert_agency: 'PADI',
        cert_level: 'Rescue',
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
