import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminVehiclesPage } from './AdminVehiclesPage'
import type { Vehicle } from '../../types/database'

const { fetchVehicles, saveVehicle, deleteVehicle } = vi.hoisted(() => ({
  fetchVehicles: vi.fn(),
  saveVehicle: vi.fn(),
  deleteVehicle: vi.fn(),
}))
vi.mock('../../lib/vehicles', () => ({
  fetchVehicles: (...a: unknown[]) => fetchVehicles(...a),
  saveVehicle: (...a: unknown[]) => saveVehicle(...a),
  deleteVehicle: (...a: unknown[]) => deleteVehicle(...a),
}))
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const fleet: Vehicle[] = [
  { id: 'v1', created_at: '', name: 'Delica', passenger_seats: 7, active: true, created_by: null },
  { id: 'v2', created_at: '', name: 'Veryca', passenger_seats: 1, active: false, created_by: null },
]

beforeEach(() => {
  fetchVehicles.mockReset().mockResolvedValue(fleet)
  saveVehicle.mockReset().mockResolvedValue(undefined)
  deleteVehicle.mockReset().mockResolvedValue(undefined)
})

function renderPage() {
  return render(<MemoryRouter><AdminVehiclesPage /></MemoryRouter>)
}

describe('AdminVehiclesPage', () => {
  it('lists vehicles with passenger seats and flags retired ones', async () => {
    renderPage()
    expect(await screen.findByText('Delica')).toBeInTheDocument()
    expect(screen.getByText(/7 passenger seats \(\+ driver\)/i)).toBeInTheDocument()
    expect(screen.getByText(/1 passenger seat \(\+ driver\)/i)).toBeInTheDocument()
    expect(screen.getByText(/\(retired\)/i)).toBeInTheDocument()
  })

  it('creates a new vehicle through the form', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Delica')
    await user.click(screen.getByRole('button', { name: /new vehicle/i }))

    await user.type(screen.getByLabelText(/^name/i), 'Sigi\'s Car')
    const seats = screen.getByLabelText(/passenger seats/i)
    await user.clear(seats)
    await user.type(seats, '4')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(saveVehicle).toHaveBeenCalledWith(
      { name: "Sigi's Car", passenger_seats: 4, active: true },
      undefined,
    ))
  })

  it('rejects a seat count below 1', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Delica')
    await user.click(screen.getByRole('button', { name: /new vehicle/i }))
    await user.type(screen.getByLabelText(/^name/i), 'Bad')
    const seats = screen.getByLabelText(/passenger seats/i)
    await user.clear(seats)
    await user.type(seats, '0')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(saveVehicle).not.toHaveBeenCalled()
  })
})
