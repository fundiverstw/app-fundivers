import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CareGearGroup } from './CareGearGroup'
import { gearPieceKey } from '../../lib/gear-packed'

const rows = [{
  item: 'Dive computer',
  divers: [
    { bookingId: 'b1', name: 'Ada Lovelace' },
    { bookingId: 'b2', name: 'Bo Chen' },
  ],
}]

describe('CareGearGroup', () => {
  it('renders nothing when nothing delicate is out', () => {
    const { container } = render(<CareGearGroup rows={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists the renters as plain text when the caller tracks no packing', () => {
    render(<CareGearGroup rows={rows} />)
    expect(screen.getByText('Ada Lovelace, Bo Chen')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('ticks a renter off and counts how far along the item is', async () => {
    const onTogglePiece = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <CareGearGroup rows={rows} packed={new Set()} onTogglePiece={onTogglePiece} />,
    )
    // Nothing packed yet, so the line claims no progress.
    expect(screen.queryByText(/packed/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /mark ada lovelace's dive computer as packed/i }))
    expect(onTogglePiece).toHaveBeenCalledWith('b1', 'Dive computer')

    rerender(
      <CareGearGroup
        rows={rows}
        packed={new Set([gearPieceKey('b1', 'Dive computer')])}
        onTogglePiece={onTogglePiece}
      />,
    )
    expect(screen.getByText(/1\/2 packed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /mark ada lovelace's dive computer as not packed/i }))
      .toHaveAttribute('aria-pressed', 'true')

    rerender(
      <CareGearGroup
        rows={rows}
        packed={new Set([gearPieceKey('b1', 'Dive computer'), gearPieceKey('b2', 'Dive computer')])}
        onTogglePiece={onTogglePiece}
      />,
    )
    expect(screen.getByText(/Packed/)).toBeInTheDocument()
  })
})
