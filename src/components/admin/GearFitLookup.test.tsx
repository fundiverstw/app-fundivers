import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GearFitLookup } from './GearFitLookup'
import type { GearModelWithSizes } from '../../lib/gear-sizing'

const womensSaeko: GearModelWithSizes = {
  id: 'm1', gear_type: 'wetsuit', name: "Women's Saeko", brand: null, gender: 'female',
  size_unit: null, notes: null, active: true, sort_order: 0, created_at: '', created_by: null,
  sizes: [
    { id: 's1', model_id: 'm1', label: '3', height_min: 157, height_max: 163, weight_min: 45, weight_max: 52, shoe_min: null, shoe_max: null, chest: null, waist: null, hip: null, sort_order: 0 },
    { id: 's2', model_id: 'm1', label: '5', height_min: 160, height_max: 165, weight_min: 50, weight_max: 57, shoe_min: null, shoe_max: null, chest: null, waist: null, hip: null, sort_order: 1 },
  ],
}
const fins: GearModelWithSizes = {
  id: 'm2', gear_type: 'fins', name: 'FD Fins', brand: null, gender: null, size_unit: 'jp',
  notes: null, active: true, sort_order: 0, created_at: '', created_by: null,
  sizes: [{ id: 'f1', model_id: 'm2', label: 'Pink', height_min: null, height_max: null, weight_min: null, weight_max: null, shoe_min: 23.5, shoe_max: 25, chest: null, waist: null, hip: null, sort_order: 0 }],
}

describe('GearFitLookup', () => {
  it('shows the ranked between-sizes fit when a diver taps the wetsuit chip', async () => {
    const user = userEvent.setup()
    render(
      <GearFitLookup
        measures={{ height_cm: 158, weight_kg: 55, shoe_size: null, gender: 'female' }}
        models={[womensSaeko]}
        rentalTypes={['wetsuit', 'bcd', 'fins']}
      />,
    )
    await user.click(screen.getByRole('button', { name: /wetsuit fit/i }))
    expect(screen.getByText("Women's Saeko")).toBeInTheDocument()
    expect(screen.getByText('3 – 5')).toBeInTheDocument()
    expect(screen.getByText(/closest/i)).toBeInTheDocument()
  })

  it('matches fins by shoe size and marks an exact band', async () => {
    const user = userEvent.setup()
    render(
      <GearFitLookup
        measures={{ height_cm: null, weight_kg: null, shoe_size: 'JP 25', gender: null }}
        models={[fins]}
        rentalTypes={['fins']}
      />,
    )
    await user.click(screen.getByRole('button', { name: /fins fit/i }))
    expect(screen.getByText('FD Fins')).toBeInTheDocument()
    expect(screen.getByText('Pink')).toBeInTheDocument()
    expect(screen.getByText('fits')).toBeInTheDocument()
  })

  it('only offers lookups for rented types that have charts', () => {
    render(
      <GearFitLookup
        measures={{ height_cm: 158, weight_kg: 55, shoe_size: null, gender: 'female' }}
        models={[womensSaeko, fins]}
        rentalTypes={['wetsuit']}   // owns fins → no fins button
      />,
    )
    expect(screen.getByRole('button', { name: /wetsuit fit/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /fins fit/i })).not.toBeInTheDocument()
  })

  it('renders nothing when the diver owns everything with a chart', () => {
    const { container } = render(
      <GearFitLookup
        measures={{ height_cm: 158, weight_kg: 55, shoe_size: null, gender: 'female' }}
        models={[womensSaeko]}
        rentalTypes={['bcd', 'fins']}  // wetsuit not rented, no bcd/fins charts
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
