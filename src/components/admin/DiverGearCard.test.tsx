import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DiverGearCard, type DiverGearRow } from './DiverGearCard'
import { gearPieceKey } from '../../lib/gear-packed'
import type { Booking, Profile } from '../../types/database'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({}), rpc: vi.fn() },
}))

vi.mock('./AdminNotes', () => ({ AdminNotes: () => null }))

const row: DiverGearRow = {
  booking: {
    id: 'b1', user_id: 'u1', status: 'confirmed',
    details: { gear: { rent: true, items: ['BCD', 'Wetsuit'] } },
  } as unknown as Booking,
  profile: {
    id: 'u1', name: 'Ada Lovelace', gear_owned: [],
    height_cm: 170, weight_kg: 62, shoe_size: null,
    fin_size: 'M', bcd_size: 'L', wetsuit_size: 'M',
  } as unknown as Profile,
}

function renderCard(props: Partial<Parameters<typeof DiverGearCard>[0]> = {}) {
  return render(
    <MemoryRouter>
      <DiverGearCard row={row} onProfilePatched={vi.fn()} {...props} />
    </MemoryRouter>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('DiverGearCard packing chips', () => {
  it('leaves the pack list as plain labels when the caller tracks no packing', () => {
    renderCard()
    const chips = screen.getAllByTitle('Needs packing')
    expect(chips.map(c => c.textContent)).toEqual(['BCD', 'Wetsuit'])
    expect(chips.every(c => c.tagName === 'SPAN')).toBe(true)
    expect(screen.queryByRole('button', { name: /packed/i })).not.toBeInTheDocument()
  })

  it('reads "Not packed" until a piece is ticked, then counts the progress', () => {
    const { rerender } = renderCard({
      packed: new Set<string>(),
      onTogglePiece: vi.fn(),
      onToggleAllPacked: vi.fn(),
    })
    expect(screen.getByRole('button', { name: /mark all of ada lovelace's gear as packed/i }))
      .toHaveTextContent('Not packed')

    rerender(
      <MemoryRouter>
        <DiverGearCard
          row={row}
          onProfilePatched={vi.fn()}
          packed={new Set([gearPieceKey('b1', 'BCD')])}
          onTogglePiece={vi.fn()}
          onToggleAllPacked={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('1/2 packed')).toBeInTheDocument()
    // The ticked piece says so on its own chip, the other still asks to be packed.
    expect(screen.getByRole('button', { name: /mark ada lovelace's bcd as not packed/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /mark ada lovelace's wetsuit as packed/i })).toBeInTheDocument()
  })

  it('says "Packed" once every piece is ticked', () => {
    renderCard({
      packed: new Set([gearPieceKey('b1', 'BCD'), gearPieceKey('b1', 'Wetsuit')]),
      onTogglePiece: vi.fn(),
      onToggleAllPacked: vi.fn(),
    })
    const chip = screen.getByRole('button', { name: /mark all of ada lovelace's gear as not packed/i })
    expect(chip).toHaveTextContent('Packed')
    expect(chip).toHaveAttribute('aria-pressed', 'true')
  })

  it('reports a tapped piece to the caller', async () => {
    const onTogglePiece = vi.fn()
    const user = userEvent.setup()
    renderCard({ packed: new Set<string>(), onTogglePiece, onToggleAllPacked: vi.fn() })

    await user.click(screen.getByRole('button', { name: /mark ada lovelace's wetsuit as packed/i }))
    expect(onTogglePiece).toHaveBeenCalledWith('b1', 'Wetsuit')
  })

  it('ticks and unticks the whole kit from the header chip', async () => {
    const onToggleAllPacked = vi.fn()
    const user = userEvent.setup()
    const { unmount } = renderCard({
      packed: new Set<string>(), onTogglePiece: vi.fn(), onToggleAllPacked,
    })
    await user.click(screen.getByRole('button', { name: /mark all of ada lovelace's gear as packed/i }))
    expect(onToggleAllPacked).toHaveBeenCalledWith('b1', ['BCD', 'Wetsuit'], true)
    unmount()

    renderCard({
      packed: new Set([gearPieceKey('b1', 'BCD'), gearPieceKey('b1', 'Wetsuit')]),
      onTogglePiece: vi.fn(),
      onToggleAllPacked,
    })
    await user.click(screen.getByRole('button', { name: /mark all of ada lovelace's gear as not packed/i }))
    expect(onToggleAllPacked).toHaveBeenLastCalledWith('b1', ['BCD', 'Wetsuit'], false)
  })

  it('offers no chip to a diver who brings their own gear', () => {
    const ownGear: DiverGearRow = {
      ...row,
      booking: { ...row.booking, details: { gear: { rent: false } } } as unknown as Booking,
    }
    render(
      <MemoryRouter>
        <DiverGearCard
          row={ownGear}
          onProfilePatched={vi.fn()}
          packed={new Set<string>()}
          onTogglePiece={vi.fn()}
          onToggleAllPacked={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: /packed/i })).not.toBeInTheDocument()
  })
})
