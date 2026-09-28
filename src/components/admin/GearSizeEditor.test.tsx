import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GearSizeEditor } from './GearSizeEditor'
import type { Profile } from '../../types/database'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

const profile = {
  id: 'u1', name: 'Ada Lovelace', fin_size: 'M', bcd_size: null, wetsuit_size: 'L',
} as unknown as Profile

beforeEach(() => rpc.mockReset())

describe('GearSizeEditor', () => {
  it('saves only once a size has changed, and hands the new sizes back', async () => {
    rpc.mockResolvedValue({ error: null })
    const onProfilePatched = vi.fn()
    const user = userEvent.setup()
    render(<GearSizeEditor profile={profile} packItems={['BCD']} onProfilePatched={onProfilePatched} />)

    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText('BCD'), 'S')
    await user.click(save)

    expect(rpc).toHaveBeenCalledWith('update_diver_gear_sizes', {
      diver_id: 'u1', fin_size: 'M', bcd_size: 'S', wetsuit_size: 'L',
    })
    expect(onProfilePatched).toHaveBeenCalledWith('u1', { fin_size: 'M', bcd_size: 'S', wetsuit_size: 'L' })
  })

  it('says why a save failed and keeps the edit', async () => {
    rpc.mockResolvedValue({ error: { message: 'not allowed' } })
    const onProfilePatched = vi.fn()
    const user = userEvent.setup()
    render(<GearSizeEditor profile={profile} packItems={[]} onProfilePatched={onProfilePatched} />)

    await user.type(screen.getByLabelText('BCD'), 'S')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('not allowed')).toBeInTheDocument()
    expect(onProfilePatched).not.toHaveBeenCalled()
    expect(screen.getByLabelText('BCD')).toHaveValue('S')
  })
})
