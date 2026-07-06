import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminGearSizingPage } from './AdminGearSizingPage'
import type { GearModelWithSizes } from '../../lib/gear-sizing'

const { fetchAll, save, del, replaceSizes } = vi.hoisted(() => ({
  fetchAll: vi.fn(), save: vi.fn(), del: vi.fn(), replaceSizes: vi.fn(),
}))
vi.mock('../../lib/gear-models', () => ({
  fetchGearModelsWithSizes: (...a: unknown[]) => fetchAll(...a),
  saveGearModel: (...a: unknown[]) => save(...a),
  deleteGearModel: (...a: unknown[]) => del(...a),
  replaceModelSizes: (...a: unknown[]) => replaceSizes(...a),
}))
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const wetsuit: GearModelWithSizes = {
  id: 'm1', gear_type: 'wetsuit', name: "Women's Saeko", brand: 'Saeko',
  gender: 'female', size_unit: null, notes: null, active: true, sort_order: 0,
  created_at: '', created_by: null,
  sizes: [
    { id: 's1', model_id: 'm1', label: '3', height_min: 157, height_max: 163, weight_min: 45, weight_max: 52, shoe_min: null, shoe_max: null, chest: '32/33', waist: null, hip: null, sort_order: 0 },
    { id: 's2', model_id: 'm1', label: '5', height_min: 160, height_max: 165, weight_min: 50, weight_max: 57, shoe_min: null, shoe_max: null, chest: null, waist: null, hip: null, sort_order: 1 },
  ],
}
const fins: GearModelWithSizes = {
  id: 'm2', gear_type: 'fins', name: 'FD Fins', brand: null, gender: null,
  size_unit: 'jp', notes: null, active: true, sort_order: 0, created_at: '', created_by: null,
  sizes: [{ id: 'f1', model_id: 'm2', label: 'Pink', height_min: null, height_max: null, weight_min: null, weight_max: null, shoe_min: 23.5, shoe_max: 25, chest: null, waist: null, hip: null, sort_order: 0 }],
}

beforeEach(() => {
  fetchAll.mockReset().mockResolvedValue([wetsuit, fins])
  save.mockReset().mockResolvedValue({ ...wetsuit })
  del.mockReset().mockResolvedValue(undefined)
  replaceSizes.mockReset().mockResolvedValue(undefined)
})

function renderPage() {
  return render(<MemoryRouter><AdminGearSizingPage /></MemoryRouter>)
}

describe('AdminGearSizingPage', () => {
  it('shows the wetsuit model and its size rows on the default tab', async () => {
    renderPage()
    expect(await screen.findByDisplayValue("Women's Saeko")).toBeInTheDocument()
    expect(screen.getByLabelText('size label 0')).toHaveValue('3')
    expect(screen.getByLabelText('size label 1')).toHaveValue('5')
    // Fins model is on another tab, not shown yet.
    expect(screen.queryByDisplayValue('FD Fins')).not.toBeInTheDocument()
  })

  it('switches to the Fins tab and shows the shoe-based model', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByDisplayValue("Women's Saeko")
    await user.click(screen.getByRole('button', { name: 'Fins' }))
    expect(await screen.findByDisplayValue('FD Fins')).toBeInTheDocument()
    expect(screen.getByLabelText('size label 0')).toHaveValue('Pink')
  })

  it('saves the model metadata and its parsed size rows', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByDisplayValue("Women's Saeko")
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0])
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0]).toMatchObject({ id: 'm1', gear_type: 'wetsuit', name: "Women's Saeko", gender: 'female' })
    expect(replaceSizes).toHaveBeenCalledWith('m1', expect.arrayContaining([
      expect.objectContaining({ label: '3', height_min: 157, weight_max: 52, chest: '32/33' }),
    ]))
  })

  it('adds a blank size row', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByDisplayValue("Women's Saeko")
    expect(screen.getByLabelText('size label 1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add size/i }))
    expect(screen.getByLabelText('size label 2')).toBeInTheDocument()
  })
})
