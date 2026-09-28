import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { GuestPackCard } from './GuestPackCard'
import { guestPieces } from '../../lib/pack-list'
import { gearPieceKey } from '../../lib/gear-packed'
import type { Booking, Profile } from '../../types/database'

vi.mock('../../lib/supabase', () => ({ supabase: { from: () => ({}), rpc: vi.fn() } }))
vi.mock('./AdminNotes', () => ({ AdminNotes: () => null }))

const row = {
  booking: {
    id: 'b1', user_id: 'u1', status: 'confirmed',
    details: { gear: { rent: true, items: ['BCD', 'Wetsuit', 'Dive computer'] } },
  } as unknown as Booking,
  profile: { id: 'u1', name: 'Ada Lovelace', gear_owned: [], bcd_size: 'M' } as unknown as Profile,
}
const pieces = guestPieces(row, new Map())

function renderCard(packed = new Set<string>(), handlers = { onToggle: vi.fn(), onSetAll: vi.fn() }) {
  render(
    <MemoryRouter>
      <GuestPackCard row={row} pieces={pieces} packed={packed} onProfilePatched={vi.fn()} {...handlers} />
    </MemoryRouter>,
  )
  return handlers
}

describe('GuestPackCard', () => {
  it("shows each of the guest's pieces as a toggle, with what a packer needs to know", () => {
    renderCard()
    expect(screen.getByRole('button', { name: /mark ada lovelace's bcd m as packed/i })).toHaveTextContent('Size M')
    expect(screen.getByRole('button', { name: /mark ada lovelace's wetsuit as packed/i })).toHaveTextContent('No size on file')
    expect(screen.getByRole('button', { name: /mark ada lovelace's dive computer as packed/i })).toHaveTextContent('Handle with care')
    expect(screen.getByText('0 of 3 packed')).toBeInTheDocument()
  })

  it('reports a tapped piece by its key, and the whole kit from Pack all', async () => {
    const user = userEvent.setup()
    const { onToggle, onSetAll } = renderCard()
    await user.click(screen.getByRole('button', { name: /mark ada lovelace's wetsuit as packed/i }))
    expect(onToggle).toHaveBeenCalledWith(gearPieceKey('b1', 'Wetsuit'))

    await user.click(screen.getByRole('button', { name: /mark all of ada lovelace's gear as packed/i }))
    expect(onSetAll).toHaveBeenCalledWith(pieces.map(p => p.key), true)
  })

  it('marks a ticked piece pressed and counts it', () => {
    renderCard(new Set([gearPieceKey('b1', 'BCD')]))
    expect(screen.getByRole('button', { name: /mark ada lovelace's bcd m as not packed/i }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('1 of 3 packed')).toBeInTheDocument()
  })

  it('folds to one line once every piece is packed, and opens again', async () => {
    const user = userEvent.setup()
    renderCard(new Set(pieces.map(p => p.key)))
    const card = screen.getByRole('article', { name: 'Ada Lovelace' })
    expect(within(card).getByText(/all 3 packed/i)).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /bcd/i })).not.toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: /show ada lovelace's gear/i }))
    expect(screen.getByRole('button', { name: /mark ada lovelace's bcd m as not packed/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /mark all of ada lovelace's gear as not packed/i })).toBeInTheDocument()
  })

  it('offers to fill in a missing size, and opens the editor on the card', async () => {
    const user = userEvent.setup()
    renderCard()
    const sizes = screen.getByRole('button', { name: /ada lovelace's sizes/i })
    expect(sizes).toHaveTextContent('Add missing size')
    await user.click(sizes)
    expect(screen.getByLabelText('Wetsuit')).toBeInTheDocument()
  })
})
