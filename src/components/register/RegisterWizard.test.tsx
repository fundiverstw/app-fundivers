import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockQueryBuilder } from '../../../tests/test-utils'
import { RegisterWizard } from './RegisterWizard'
import type { PackageTierItem } from '../../types/database'

// With an empty catalog the wizard never queries supabase, but the module still
// imports it — give it a chainable stub so the import resolves.
vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => mockQueryBuilder({ data: [] }) },
}))

const tiers: PackageTierItem[] = [
  { id: 't1', package_id: 'p1', name: 'Package A', price: 1000, currency: 'TWD', sort_order: 0 },
]

let onSubmit: ReturnType<typeof vi.fn>
let onRegistered: ReturnType<typeof vi.fn>
beforeEach(() => {
  onSubmit = vi.fn().mockResolvedValue({ registration_id: 'reg1', emailed: true })
  onRegistered = vi.fn()
})

describe('RegisterWizard — package config (tiers + picked dates)', () => {
  it('walks tier → dates → extras → review and submits the selection', async () => {
    const user = userEvent.setup()
    render(
      <RegisterWizard
        title="Raja Ampat" subtitle="with Blue Manta" currency="TWD"
        tiers={tiers} baseLabel="Package" dateMode="pick"
        addonIds={[]} roomTypeIds={[]}
        disclaimer="estimate only"
        onClose={vi.fn()} onSubmit={onSubmit} onRegistered={onRegistered}
      />,
    )
    // 4 steps: tier (default selected) → dates → extras → review.
    expect(screen.getByText(/step 1 of 4/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.type(screen.getByLabelText('Preferred start date'), '20260901')
    await user.type(screen.getByLabelText('Preferred end date'), '20260908')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText(/No add-ons or room options/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Register' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      tierId: 't1', start: '2026-09-01', end: '2026-09-08', addonIds: [], roomId: null, notes: '',
    }))
    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith(
      expect.objectContaining({ registration_id: 'reg1' }),
    ))
  })
})

describe('RegisterWizard — trip config (single price + fixed dates)', () => {
  it('skips the tier and date steps and submits with the fixed dates', async () => {
    const user = userEvent.setup()
    render(
      <RegisterWizard
        title="Green Island Weekend" currency="TWD"
        basePrice={12000} baseLabel="Trip" dateMode="fixed"
        fixedStart="2026-09-01" fixedEnd="2026-09-03"
        addonIds={[]} roomTypeIds={[]}
        disclaimer="the shop will confirm"
        onClose={vi.fn()} onSubmit={onSubmit} onRegistered={onRegistered}
      />,
    )
    // Only 2 steps: extras → review (no tier, no date step).
    expect(screen.getByText(/step 1 of 2/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Register' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      tierId: null, start: '2026-09-01', end: '2026-09-03', addonIds: [], roomId: null,
    }))
    await waitFor(() => expect(onRegistered).toHaveBeenCalled())
  })
})
