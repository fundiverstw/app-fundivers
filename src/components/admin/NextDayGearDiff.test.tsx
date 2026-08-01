import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { NextDayGearDiff } from './NextDayGearDiff'
import { gearDayDiff } from '../../lib/logistics'
import type { Booking, Profile } from '../../types/database'

const diver = (id: string, name: string, items: string[], sizes: Partial<Profile> = {}) => ({
  booking: { id, details: { gear: { rent: true, items } } } as unknown as Booking,
  profile: { name, ...sizes } as unknown as Profile,
})

function renderDiff(today: ReturnType<typeof diver>[], next: ReturnType<typeof diver>[]) {
  return render(<NextDayGearDiff day="2026-06-19" diff={gearDayDiff(today, next)} />)
}

const column = (name: RegExp) => within(screen.getByRole('group', { name }))

describe('NextDayGearDiff', () => {
  it('splits the overlap into what stays out, what to add and what goes back', () => {
    renderDiff(
      [diver('b1', 'Ada', ['BCD'], { bcd_size: 'M' }), diver('b2', 'Bo', ['BCD'], { bcd_size: 'S' })],
      [diver('b3', 'Cy', ['BCD'], { bcd_size: 'M' }), diver('b4', 'Di', ['BCD'], { bcd_size: 'XL' })],
    )
    expect(column(/stays out/i).getByText('BCD · M ×1')).toBeInTheDocument()
    expect(column(/also pack/i).getByText('BCD · XL ×1')).toBeInTheDocument()
    expect(column(/back to the shop/i).getByText('BCD · S ×1')).toBeInTheDocument()
  })

  it('heads each column with how many pieces it accounts for', () => {
    renderDiff(
      [diver('b1', 'Ada', ['Regulator']), diver('b2', 'Bo', ['Regulator'])],
      [diver('b3', 'Cy', ['Regulator'])],
    )
    // Two regulators out, one reused, one home. Regulators are one-size, so the
    // chip carries no size at all.
    expect(screen.getByRole('group', { name: /stays out/i })).toHaveTextContent(/· 1 piece/)
    expect(screen.getByRole('group', { name: /back to the shop/i })).toHaveTextContent(/· 1 piece/)
    expect(column(/stays out/i).getByText('Regulator ×1')).toBeInTheDocument()
  })

  it('says "Nothing" for a column with no pieces rather than dropping it', () => {
    renderDiff([diver('b1', 'Ada', ['BCD'], { bcd_size: 'M' })], [])
    expect(column(/stays out/i).getByText(/nothing/i)).toBeInTheDocument()
    expect(column(/also pack/i).getByText(/nothing/i)).toBeInTheDocument()
    expect(column(/back to the shop/i).getByText('BCD · M ×1')).toBeInTheDocument()
  })

  it('holds pieces with no size on file out of all three columns', () => {
    renderDiff(
      [diver('b1', 'Ada', ['Wetsuit'], { wetsuit_size: null })],
      [diver('b2', 'Bo', ['Wetsuit'], { wetsuit_size: null })],
    )
    // They can't be matched, so listing them as both "pack" and "return" would
    // crowd out the real answer with the same piece counted twice.
    for (const col of [/stays out/i, /also pack/i, /back to the shop/i]) {
      expect(column(col).getByText(/nothing/i)).toBeInTheDocument()
    }
    const chase = within(screen.getByRole('group', { name: /sizes to confirm/i }))
    expect(chase.getByText('Wetsuit ×1')).toBeInTheDocument()
    expect(chase.getByText('Bo')).toBeInTheDocument()
  })

  it('still shows the sized pieces when one diver has no size on file', () => {
    // The reported symptom: with the unsized lines mixed in, the matched pieces
    // vanished into "stays out" and the board read as if nothing had sizes.
    renderDiff(
      [diver('b1', 'Ada', ['BCD'], { bcd_size: 'M' }), diver('b2', 'Bo', ['BCD'], {})],
      [diver('b3', 'Cy', ['BCD'], { bcd_size: 'L' }), diver('b4', 'Di', ['BCD'], {})],
    )
    expect(column(/back to the shop/i).getByText('BCD · M ×1')).toBeInTheDocument()
    expect(column(/also pack/i).getByText('BCD · L ×1')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /sizes to confirm/i })).toHaveTextContent('BCD ×1')
  })

  it('shows a loading note while the next day is still being read', () => {
    render(<NextDayGearDiff day="2026-06-19" diff={null} />)
    expect(screen.getByText(/reading the next day/i)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /stays out/i })).not.toBeInTheDocument()
  })

  it('says so plainly when neither day rents anything', () => {
    renderDiff([], [])
    expect(screen.getByText(/neither day rents gear/i)).toBeInTheDocument()
  })
})
