import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockQueryBuilder } from '../../../tests/test-utils'
import { PackageRegisterForm } from './PackageRegisterForm'
import type { PackageBoardItem, PackageTierItem } from '../../types/database'

const { registerForPackage } = vi.hoisted(() => ({ registerForPackage: vi.fn() }))

vi.mock('../../lib/packages', () => ({
  registerForPackage: (...a: unknown[]) => registerForPackage(...a),
}))

// With an empty catalog the form never queries supabase, but the module still
// imports it — give it a chainable stub so the import resolves.
vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => mockQueryBuilder({ data: [] }) },
}))

const pkg = {
  id: 'p1', title: 'Raja Ampat Liveaboard', partner_name: 'Blue Manta Divers',
  currency: 'TWD', addon_ids: [], room_type_ids: [],
} as unknown as PackageBoardItem

const tiers: PackageTierItem[] = [
  { id: 't1', package_id: 'p1', name: 'Package A', price: 1000, currency: 'TWD', sort_order: 0 },
]

beforeEach(() => {
  registerForPackage.mockReset()
  registerForPackage.mockResolvedValue({
    registration_id: 'reg1', estimated_cost: 1000, estimated_currency: 'TWD',
  })
})

describe('PackageRegisterForm', () => {
  it('walks tier → dates → extras → review and registers', async () => {
    const user = userEvent.setup()
    const onRegistered = vi.fn()
    render(<PackageRegisterForm pkg={pkg} tiers={tiers} onClose={vi.fn()} onRegistered={onRegistered} />)

    // Step 1 — the first tier is selected by default.
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // Step 2 — type a preferred date range.
    await user.type(screen.getByLabelText('Preferred start date'), '20260901')
    await user.type(screen.getByLabelText('Preferred end date'), '20260908')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // Step 3 — no catalog add-ons/rooms for this package.
    expect(screen.getByText(/No add-ons or room options/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))

    // Step 4 — review + submit.
    await user.click(screen.getByRole('button', { name: 'Register' }))

    await waitFor(() => expect(registerForPackage).toHaveBeenCalledTimes(1))
    expect(registerForPackage).toHaveBeenCalledWith(expect.objectContaining({
      packageId: 'p1', tierId: 't1', preferredStart: '2026-09-01', preferredEnd: '2026-09-08',
      addonIds: [], roomId: null, notes: '',
    }))
    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith(
      expect.objectContaining({ registration_id: 'reg1' }),
    ))
  })
})
