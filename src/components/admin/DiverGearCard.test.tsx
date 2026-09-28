import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DiverGearCard, type DiverGearRow } from './DiverGearCard'
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
    id: 'u1', name: 'Ada Lovelace', gear_owned: ['Wetsuit'],
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

describe('DiverGearCard', () => {
  it('lists the pack list as plain labels, with nothing to tick', () => {
    renderCard()
    expect(screen.getByTitle('Needs packing')).toHaveTextContent('BCD')
    expect(screen.getByTitle('Diver owns this item')).toHaveTextContent('Wetsuit')
    expect(screen.queryByRole('button', { name: /packed/i })).not.toBeInTheDocument()
  })

  it('shows the measurements a packer sizes from', () => {
    renderCard()
    expect(screen.getByText('170cm · 62kg')).toBeInTheDocument()
  })

  it('links the name to the People card only when asked', () => {
    const { unmount } = renderCard({ linkToProfile: true })
    expect(screen.getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', '/admin/users?diver=u1')
    unmount()
    renderCard()
    expect(screen.queryByRole('link', { name: 'Ada Lovelace' })).not.toBeInTheDocument()
  })
})
