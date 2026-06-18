import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AdminGearMapPage } from './AdminGearMapPage'
import { mockQueryBuilder } from '../../../tests/test-utils'

const { from, rpc } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc:  vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => from(...a),
    rpc:  (...a: unknown[]) => rpc(...a),
  },
}))

vi.mock('../../lib/events', () => ({
  fetchEventsForBookings: vi.fn(async () => new Map([
    ['e1', { id: 'e1', type: 'dive', title: 'Test dive', start_time: '2027-05-15T00:00:00Z', end_time: null }],
  ])),
  formatEventSpan: () => 'May 15',
}))

vi.mock('../../components/admin/AdminNotes', () => ({
  AdminNotes: () => null,
}))

const sampleBooking = {
  id: 'b1', user_id: 'u1', status: 'pending',
  details: { gear: { rent: true, mode: 'a-la-carte', items: ['BCD', 'Wetsuit'] } },
}
const sampleProfile = {
  id: 'u1', nickname: 'Ada Lovelace',
  height_cm: 170, weight_kg: 65, shoe_size: null,
  fin_size: 'M', bcd_size: 'L', wetsuit_size: null,
  gear_owned: [],
}

beforeEach(() => {
  from.mockReset(); rpc.mockReset()
  rpc.mockResolvedValue({ error: null })
  from.mockImplementation((table: string) => {
    if (table === 'bookings') return mockQueryBuilder({ data: [sampleBooking] })
    if (table === 'profiles') return mockQueryBuilder({ data: [sampleProfile] })
    return mockQueryBuilder({ data: [] })
  })
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/events/dive/e1/gear-map']}>
      <Routes>
        <Route path="/admin/events/:type/:id/gear-map" element={<AdminGearMapPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AdminGearMapPage gear-size editor', () => {
  it('seeds inputs from the diver profile and calls update_diver_gear_sizes RPC on save', async () => {
    renderPage()
    const finInput = await screen.findByLabelText(/^fin$/i) as HTMLInputElement
    const bcdInput = screen.getByLabelText(/^bcd$/i) as HTMLInputElement
    const wetInput = screen.getByLabelText(/^wetsuit$/i) as HTMLInputElement
    expect(finInput.value).toBe('M')
    expect(bcdInput.value).toBe('L')
    expect(wetInput.value).toBe('')

    // Save is disabled when nothing changed.
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    const user = userEvent.setup()
    await user.clear(finInput); await user.type(finInput, 'L')
    await user.type(wetInput, '7mm M')
    expect(save).toBeEnabled()

    await user.click(save)
    await waitFor(() => expect(rpc).toHaveBeenCalledOnce())
    const [name, args] = rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('update_diver_gear_sizes')
    expect(args).toEqual({
      diver_id:     'u1',
      fin_size:     'L',
      bcd_size:     'L',
      wetsuit_size: '7mm M',
    })

    // After a successful save the inputs reflect the new "saved" state and
    // the Save button goes back to disabled.
    await waitFor(() => expect(save).toBeDisabled())
  })

  it('surfaces RPC errors inline without applying the optimistic patch', async () => {
    rpc.mockResolvedValueOnce({ error: { message: 'staff or admin required' } })
    renderPage()
    const finInput = await screen.findByLabelText(/^fin$/i) as HTMLInputElement

    const user = userEvent.setup()
    await user.clear(finInput); await user.type(finInput, 'XS')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/staff or admin required/i)).toBeInTheDocument()
    // Save remains enabled (still dirty) so the user can retry / fix.
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})
