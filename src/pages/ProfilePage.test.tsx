import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfilePage } from './ProfilePage'
import { renderWithRouter, mockQueryBuilder } from '../../tests/test-utils'

const { update, from, useAuthMock, uploadCertCard, getCertCardSignedUrl, deleteCertCard } = vi.hoisted(() => ({
  update: vi.fn(),
  from: vi.fn(),
  useAuthMock: vi.fn(),
  uploadCertCard: vi.fn(),
  getCertCardSignedUrl: vi.fn(),
  deleteCertCard: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

vi.mock('../lib/cert-card', () => ({
  uploadCertCard: (...a: unknown[]) => uploadCertCard(...a),
  getCertCardSignedUrl: (...a: unknown[]) => getCertCardSignedUrl(...a),
  deleteCertCard: (...a: unknown[]) => deleteCertCard(...a),
}))

function input(name: string): HTMLInputElement | HTMLTextAreaElement {
  const el = document.querySelector(`[name="${name}"]`)
  if (!el) throw new Error(`no form control with name=${name}`)
  return el as HTMLInputElement
}

beforeEach(() => {
  update.mockReset()
  from.mockReset()
  useAuthMock.mockReset()
  uploadCertCard.mockReset()
  getCertCardSignedUrl.mockReset()
  deleteCertCard.mockReset()
})

describe('ProfilePage', () => {
  it('shows required error when full name is cleared and submitted', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      // uncertified so the cert-status gate is satisfied and Save can fire,
      // isolating the name-required assertion.
      profile: { id: 'u1', name: 'Ada Lovelace', uncertified: true },
    })
    from.mockReturnValue({
      ...mockQueryBuilder(),
      update: (...a: unknown[]) => { update(...a); return mockQueryBuilder() },
    })
    const user = userEvent.setup()
    renderWithRouter(<ProfilePage />)

    await waitFor(() => expect((input('name') as HTMLInputElement).value).toBe('Ada Lovelace'))

    await user.clear(input('name'))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect((await screen.findAllByText(/required/i)).length).toBeGreaterThan(0)
    expect(update).not.toHaveBeenCalled()
  })

  it('submit is disabled when the form is clean', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: { id: 'u1', name: 'Ada' },
    })
    from.mockReturnValue(mockQueryBuilder())
    renderWithRouter(<ProfilePage />)
    const btn = await screen.findByRole('button', { name: /save changes/i })
    await waitFor(() => expect(btn).toBeDisabled())
  })

  it('updates own profile row with form values and updated_at on submit', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: {
        id: 'u1',
        name: 'Ada',
        nickname: 'Ada',
        date_of_birth: '1815-12-10',
        // gender + nationality are now required to save; seed them so this
        // test exercises a valid submit rather than tripping the new gate.
        gender: 'female',
        contact_method: 'email',
        contact_id: 'ada@example.com',
        cert_level: 'Open Water',
        // cert_level=set + no cert_card_path now blocks Save (new gate).
        // The test isn't exercising that gate, so seed a card path.
        cert_card_path: 'u1/existing.jpg',
        logged_dives: 0,
      },
    })
    const eqSpy = vi.fn()
    from.mockImplementation(() => ({
      ...mockQueryBuilder({ data: { cert_card_path: 'u1/existing.jpg' } }),
      update: (...a: unknown[]) => {
        update(...a)
        return {
          ...mockQueryBuilder(),
          eq: (...e: unknown[]) => { eqSpy(...e); return mockQueryBuilder() },
        }
      },
    }))

    const user = userEvent.setup()
    renderWithRouter(<ProfilePage />)
    await waitFor(() => expect((input('name') as HTMLInputElement).value).toBe('Ada'))

    await user.clear(input('name'))
    await user.type(input('name'), 'Ada L.')
    await user.type(input('nationality'), 'British')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    const payload = update.mock.calls[0][0] as Record<string, unknown>
    expect(payload.id).toBeUndefined() // id is in the .eq filter, not the payload
    expect(payload.name).toBe('Ada L.')
    expect(payload.nationality).toBe('British')
    expect(typeof payload.updated_at).toBe('string')
    expect(new Date(payload.updated_at as string).toString()).not.toBe('Invalid Date')
    expect(from).toHaveBeenCalledWith('profiles')
    expect(eqSpy).toHaveBeenCalledWith('id', 'u1')
  })

  it('toggles gear owned and includes it in the update payload', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: {
        id: 'u1',
        name: 'Ada',
        nickname: 'Ada',
        date_of_birth: '1815-12-10',
        nationality: 'British',
        gender: 'female',
        contact_method: 'email',
        contact_id: 'ada@example.com',
        cert_level: 'Open Water',
        cert_card_path: 'u1/existing.jpg',
        logged_dives: 0,
        gear_owned: [],
      },
    })
    from.mockImplementation(() => ({
      ...mockQueryBuilder({ data: { cert_card_path: 'u1/existing.jpg' } }),
      update: (...a: unknown[]) => { update(...a); return mockQueryBuilder() },
    }))

    const user = userEvent.setup()
    renderWithRouter(<ProfilePage />)
    await waitFor(() => expect((input('name') as HTMLInputElement).value).toBe('Ada'))

    await user.click(screen.getByLabelText('BCD'))
    await user.click(screen.getByLabelText('Fins'))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    const payload = update.mock.calls[0][0] as Record<string, unknown>
    expect(payload.gear_owned).toEqual(['BCD', 'Fins'])
  })

  it('prefills existing gear_owned and canonicalizes shoe_size on save', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: {
        id: 'u1',
        name: 'Ada',
        nickname: 'Ada',
        date_of_birth: '1815-12-10',
        nationality: 'British',
        gender: 'female',
        contact_method: 'email',
        contact_id: 'ada@example.com',
        cert_level: 'Open Water',
        cert_card_path: 'u1/existing.jpg',
        logged_dives: 0,
        gear_owned: ['BCD', 'Fins'],
        shoe_size: 'EU 41 M',
      },
    })
    from.mockImplementation(() => ({
      ...mockQueryBuilder({ data: { cert_card_path: 'u1/existing.jpg' } }),
      update: (...a: unknown[]) => { update(...a); return mockQueryBuilder() },
    }))

    const user = userEvent.setup()
    renderWithRouter(<ProfilePage />)

    // BCD + Fins already ticked; Mask is not
    await waitFor(() => {
      expect((screen.getByLabelText('BCD') as HTMLInputElement).checked).toBe(true)
      expect((screen.getByLabelText('Fins') as HTMLInputElement).checked).toBe(true)
      expect((screen.getByLabelText('Mask') as HTMLInputElement).checked).toBe(false)
    })

    // Shoe selector seeded from canonical string
    const unitSel = screen.getByLabelText('Shoe size unit') as HTMLSelectElement
    const genderSel = screen.getByLabelText('Shoe size gender') as HTMLSelectElement
    const sizeSel = screen.getByLabelText('Shoe size value') as HTMLSelectElement
    expect(unitSel.value).toBe('eu')
    expect(genderSel.value).toBe('m')
    expect(sizeSel.value).toBe('41')

    // Change size, save, confirm canonical format flows through
    await user.selectOptions(sizeSel, '42')
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    const payload = update.mock.calls[0][0] as Record<string, unknown>
    expect(payload.shoe_size).toBe('EU 42 M')
    expect(payload.gear_owned).toEqual(['BCD', 'Fins'])
  })

  it('lets an uncertified diver save without a cert level or card', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: {
        id: 'u1', name: 'Ada', nickname: 'Ada', date_of_birth: '1815-12-10',
        nationality: 'British', gender: 'female',
        contact_method: 'email', contact_id: 'ada@example.com', logged_dives: 0,
      },
    })
    from.mockReturnValue({
      ...mockQueryBuilder(),
      update: (...a: unknown[]) => { update(...a); return mockQueryBuilder() },
    })
    const user = userEvent.setup()
    renderWithRouter(<ProfilePage />)
    await waitFor(() => expect((input('name') as HTMLInputElement).value).toBe('Ada'))

    // No agency dropdown or cert-card upload until a status is chosen.
    expect(screen.queryByText('— select agency —')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Upload certification card')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('I am uncertified'))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    const payload = update.mock.calls[0][0] as Record<string, unknown>
    expect(payload.uncertified).toBe(true)
    expect(payload.cert_level).toBeNull()
    // Still no cert-card section after choosing uncertified.
    expect(screen.queryByLabelText('Upload certification card')).not.toBeInTheDocument()
  })

  it('uploads and saves a cert card when the user picks a file', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      // cert_level set ⇒ certified ⇒ the cert-card section is shown.
      profile: { id: 'u1', name: 'Ada', cert_level: 'Open Water' },
    })
    from.mockReturnValue(mockQueryBuilder({ data: { cert_card_path: null } }))
    uploadCertCard.mockResolvedValue('u1/card_123.jpg')
    getCertCardSignedUrl.mockResolvedValue('https://signed.example/card.jpg')

    const user = userEvent.setup()
    renderWithRouter(<ProfilePage />)

    const fileInput = await screen.findByLabelText('Upload certification card')
    const fakeFile = new File(['x'], 'cert.jpg', { type: 'image/jpeg' })
    await user.upload(fileInput, fakeFile)

    await waitFor(() => expect(uploadCertCard).toHaveBeenCalledOnce())
    expect(uploadCertCard).toHaveBeenCalledWith('u1', fakeFile)
  })

  it('removes the cert card on demand', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      // cert_level set ⇒ certified ⇒ the cert-card section is shown.
      profile: { id: 'u1', name: 'Ada', cert_level: 'Open Water' },
    })
    from.mockReturnValue(mockQueryBuilder({ data: { cert_card_path: 'u1/existing.jpg' } }))
    getCertCardSignedUrl.mockResolvedValue('https://signed.example/existing.jpg')
    deleteCertCard.mockResolvedValue(undefined)

    const user = userEvent.setup()
    renderWithRouter(<ProfilePage />)

    const removeBtn = await screen.findByRole('button', { name: /^remove$/i })
    await user.click(removeBtn)

    await waitFor(() => expect(deleteCertCard).toHaveBeenCalledWith('u1/existing.jpg'))
  })

  it('disables Save when cert_level is set but no cert card is on file', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'u1' },
      profile: {
        id: 'u1',
        name: 'Ada',
        nickname: 'Ada',
        date_of_birth: '1815-12-10',
        contact_method: 'email',
        contact_id: 'ada@example.com',
        cert_level: 'Open Water',
        cert_card_path: null,
        logged_dives: 0,
      },
    })
    // CertCardSection's load also resolves cert_card_path=null, so the
    // missing-card banner appears and Save stays disabled until a photo
    // is uploaded via the section.
    from.mockReturnValue(mockQueryBuilder({ data: { cert_card_path: null } }))

    renderWithRouter(<ProfilePage />)
    await waitFor(() => {
      expect(screen.getByText(/upload a photo of your highest certification card/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
  })

  it('does not render the form (and thus cannot submit) when there is no authenticated user', () => {
    useAuthMock.mockReturnValue({ user: null, profile: null })
    renderWithRouter(<ProfilePage />)
    // The page header still renders; the form is gated on user + profile.
    expect(screen.getByText(/my profile/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })
})
