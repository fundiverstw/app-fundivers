import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AdminAddDiverModal } from './AdminAddDiverModal'
import { mockQueryBuilder } from '../../../tests/test-utils'
import { t } from '../../i18n'
import type { AppEvent, Profile } from '../../types/database'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

// Stub the heavy register form — we only assert which diver the modal lands on.
vi.mock('../register/RegisterForm', () => ({
  RegisterFormBody: ({ profile }: { profile: Profile }) => (
    <div data-testid="register-body">registering:{profile.id}</div>
  ),
}))

const ad = t.admin.addDiver
const event = { id: 'ev1', title: 'Green Island Fun Dive' } as unknown as AppEvent
const roster = [
  { id: 'd1', name: 'Jane Diver', nickname: null },
  { id: 'd2', name: 'John Diver', nickname: null },
] as unknown as Profile[]

beforeEach(() => {
  from.mockReset()
  from.mockImplementation(() => mockQueryBuilder({ data: roster }))
})

describe('AdminAddDiverModal preselect', () => {
  it('opens straight on the register form for initialDiverId, skipping the picker', async () => {
    render(<AdminAddDiverModal event={event} initialDiverId="d1" onClose={() => {}} onAdded={() => {}} />)

    await waitFor(() => expect(screen.getByTestId('register-body')).toHaveTextContent('registering:d1'))
    // The search picker must not be shown when a diver is preselected.
    expect(screen.queryByPlaceholderText(ad.searchPlaceholder)).not.toBeInTheDocument()
  })

  it('shows the picker when no diver is preselected', async () => {
    render(<AdminAddDiverModal event={event} onClose={() => {}} onAdded={() => {}} />)

    await waitFor(() => expect(screen.getByPlaceholderText(ad.searchPlaceholder)).toBeInTheDocument())
    expect(screen.queryByTestId('register-body')).not.toBeInTheDocument()
  })

  it('ignores an initialDiverId that matches no one and falls back to the picker', async () => {
    render(<AdminAddDiverModal event={event} initialDiverId="ghost" onClose={() => {}} onAdded={() => {}} />)

    await waitFor(() => expect(screen.getByPlaceholderText(ad.searchPlaceholder)).toBeInTheDocument())
    expect(screen.queryByTestId('register-body')).not.toBeInTheDocument()
  })
})
