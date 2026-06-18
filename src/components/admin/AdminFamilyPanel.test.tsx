import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminFamilyPanel } from './AdminFamilyPanel'
import { mockQueryBuilder } from '../../../tests/test-utils'
import type { Profile } from '../../types/database'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn() }),
}))

function makeProfile(overrides: Partial<Profile>): Profile {
  return {
    id: 'x', created_at: '', updated_at: '',
    name: 'X', nickname: null,
    date_of_birth: null, nationality: null, id_number: null,
    emergency_contact_name: null, emergency_contact_phone: null,
    cert_agency: null, cert_level: null, cert_card_path: null, nitrox_card_path: null,
    medical_notes: null, avatar_url: null, role: 'diver',
    height_cm: null, weight_kg: null, shoe_size: null,
    fin_size: null, bcd_size: null, wetsuit_size: null,
    gender: null, contact_method: null, contact_id: null,
    nitrox_certified: false, logged_dives: 0, last_dive_date: null,
    gear_owned: [], agreed_to_terms_at: null,
    status: 'active', parent_account: null,
    ...overrides,
  }
}

beforeEach(() => {
  from.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
})

describe('AdminFamilyPanel', () => {
  it('top-level diver with no children: shows the picker and empty-children message', () => {
    const parent = makeProfile({ id: 'p1', name: 'Pat Parent' })
    const eligible = makeProfile({ id: 'c1', name: 'Cara Candidate' })
    render(<AdminFamilyPanel user={parent} allUsers={[parent, eligible]} onChanged={() => {}} />)

    expect(screen.getByText(/no linked child accounts/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/search divers/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /link cara candidate as child/i })).toBeInTheDocument()
  })

  it('lists already-linked children and shows an Unlink button per row', () => {
    const parent = makeProfile({ id: 'p1', name: 'Pat Parent' })
    const child  = makeProfile({ id: 'c1', name: 'Kid One', parent_account: 'p1' })
    render(<AdminFamilyPanel user={parent} allUsers={[parent, child]} onChanged={() => {}} />)

    expect(screen.getByText('Kid One')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /unlink kid one/i })).toBeInTheDocument()
  })

  it('eligibility filter excludes self, non-divers, existing parents, and existing children', () => {
    const parent     = makeProfile({ id: 'p1', name: 'Pat Parent' })
    const childOwn   = makeProfile({ id: 'c-own', name: 'Own Child', parent_account: 'p1' })
    const childOther = makeProfile({ id: 'c-other', name: 'Other Child', parent_account: 'p2' })
    const otherParent = makeProfile({ id: 'p2', name: 'Other Parent' })  // has childOther → ineligible
    const staff      = makeProfile({ id: 's1', name: 'Stella Staff', role: 'staff' })
    const eligible   = makeProfile({ id: 'd1', name: 'Diane Diver' })

    render(
      <AdminFamilyPanel
        user={parent}
        allUsers={[parent, childOwn, childOther, otherParent, staff, eligible]}
        onChanged={() => {}}
      />
    )

    // Picker contains only Diane.
    expect(screen.getByRole('button', { name: /link diane diver as child/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /link pat parent as child/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /link stella staff as child/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /link other parent as child/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /link other child as child/i })).not.toBeInTheDocument()
  })

  it('search filter narrows the picker by name', async () => {
    const parent = makeProfile({ id: 'p1', name: 'Pat' })
    const ada    = makeProfile({ id: 'a',  name: 'Ada Lovelace' })
    const bob    = makeProfile({ id: 'b',  name: 'Bob Roberts' })

    const user = userEvent.setup()
    render(<AdminFamilyPanel user={parent} allUsers={[parent, ada, bob]} onChanged={() => {}} />)

    expect(screen.getByRole('button', { name: /link ada lovelace as child/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /link bob roberts as child/i })).toBeInTheDocument()

    await user.type(screen.getByLabelText(/search divers/i), 'ada')
    expect(screen.getByRole('button', { name: /link ada lovelace as child/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /link bob roberts as child/i })).not.toBeInTheDocument()
  })

  it('clicking "Link as child" updates the child profile and calls onChanged', async () => {
    const update = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) })
    from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.update = update
        return b
      }
      return mockQueryBuilder({ data: [] })
    })

    const parent  = makeProfile({ id: 'p1', name: 'Pat Parent' })
    const candidate = makeProfile({ id: 'c1', name: 'Cara Candidate' })
    const onChanged = vi.fn()

    const user = userEvent.setup()
    render(<AdminFamilyPanel user={parent} allUsers={[parent, candidate]} onChanged={onChanged} />)

    await user.click(screen.getByRole('button', { name: /link cara candidate as child/i }))

    await waitFor(() => expect(update).toHaveBeenCalledWith({ parent_account: 'p1' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('clicking Unlink on a child row clears parent_account and calls onChanged', async () => {
    const update = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) })
    from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.update = update
        return b
      }
      return mockQueryBuilder({ data: [] })
    })

    const parent = makeProfile({ id: 'p1', name: 'Pat Parent' })
    const child  = makeProfile({ id: 'c1', name: 'Kid One', parent_account: 'p1' })
    const onChanged = vi.fn()

    const user = userEvent.setup()
    render(<AdminFamilyPanel user={parent} allUsers={[parent, child]} onChanged={onChanged} />)

    await user.click(screen.getByRole('button', { name: /unlink kid one/i }))

    await waitFor(() => expect(update).toHaveBeenCalledWith({ parent_account: null }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('viewing a child shows parent name + an Unlink-from-parent button (no picker)', async () => {
    const update = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) })
    from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.update = update
        return b
      }
      return mockQueryBuilder({ data: [] })
    })

    const parent = makeProfile({ id: 'p1', name: 'Pat Parent' })
    const child  = makeProfile({ id: 'c1', name: 'Kid One', parent_account: 'p1' })
    const onChanged = vi.fn()

    const user = userEvent.setup()
    render(<AdminFamilyPanel user={child} allUsers={[parent, child]} onChanged={onChanged} />)

    expect(screen.getByText(/linked as a child of/i)).toBeInTheDocument()
    expect(screen.getByText(/pat parent/i)).toBeInTheDocument()
    // No picker / search in this mode.
    expect(screen.queryByLabelText(/search divers/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /unlink from parent/i }))
    await waitFor(() => expect(update).toHaveBeenCalledWith({ parent_account: null }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('surfaces the error toast when the link write fails (e.g. trigger blocks demoting a parent)', async () => {
    const update = vi.fn().mockReturnValue({
      eq: () => Promise.resolve({ error: { message: 'cannot set parent_account on a diver who already has their own children' } }),
    })
    from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.update = update
        return b
      }
      return mockQueryBuilder({ data: [] })
    })

    const parent = makeProfile({ id: 'p1', name: 'Pat' })
    const candidate = makeProfile({ id: 'c1', name: 'Cara' })
    const user = userEvent.setup()
    render(<AdminFamilyPanel user={parent} allUsers={[parent, candidate]} onChanged={() => {}} />)

    await user.click(screen.getByRole('button', { name: /link cara as child/i }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/cannot set parent_account/i)))
  })
})
