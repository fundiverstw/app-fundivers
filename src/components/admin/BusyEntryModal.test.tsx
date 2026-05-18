import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BusyEntryModal } from './BusyEntryModal'
import type { StaffBusyEntry } from '../../types/database'

const { createMock, updateMock, deleteMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
}))

vi.mock('../../lib/staff-availability', () => ({
  createStaffAvailability: (...a: unknown[]) => createMock(...a),
  updateStaffAvailability: (...a: unknown[]) => updateMock(...a),
  deleteStaffAvailability: (...a: unknown[]) => deleteMock(...a),
}))

beforeEach(() => {
  createMock.mockReset()
  updateMock.mockReset()
  deleteMock.mockReset()
})

const baseEntry: StaffBusyEntry = {
  id: 'b1',
  user_id: 'u1',
  start_date: '2030-06-01',
  start_time: '09:00:00',
  end_date:   '2030-06-03',
  title: 'Conference',
  details: 'In Tokyo',
  owner_display_name: 'Ada',
  created_at: '2030-01-01T00:00:00Z',
  updated_at: '2030-01-01T00:00:00Z',
}

describe('BusyEntryModal (create)', () => {
  it('submits a new entry with the form values', async () => {
    createMock.mockResolvedValue({ ...baseEntry, id: 'new1', title: 'Vacation' })
    const onSaved = vi.fn()
    const user = userEvent.setup()
    render(
      <BusyEntryModal
        mode="create"
        userId="u1"
        defaultDate="2030-07-04"
        onClose={() => {}}
        onSaved={onSaved}
      />
    )
    await user.clear(screen.getByLabelText(/title/i))
    await user.type(screen.getByLabelText(/title/i), 'Vacation')
    await user.click(screen.getByRole('button', { name: /mark busy/i }))
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'u1',
      start_date: '2030-07-04',
      end_date:   '2030-07-04',
      title: 'Vacation',
    }))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'new1' }))
  })

  it('rejects an end_date earlier than start_date with an inline error', async () => {
    const user = userEvent.setup()
    render(
      <BusyEntryModal
        mode="create"
        userId="u1"
        defaultDate="2030-07-10"
        onClose={() => {}}
        onSaved={() => {}}
      />
    )
    // Force end_date earlier than start_date by typing into both.
    await user.type(screen.getByLabelText(/title/i), 'Trip')
    const endDate = screen.getByLabelText(/end date/i)
    // Manually drive value change; date inputs in happy-dom accept ISO strings.
    await user.clear(endDate)
    await user.type(endDate, '2030-07-05')
    await user.click(screen.getByRole('button', { name: /mark busy/i }))
    expect(createMock).not.toHaveBeenCalled()
    expect(await screen.findByText(/end date must be on or after start date/i)).toBeInTheDocument()
  })
})

describe('BusyEntryModal (edit)', () => {
  it('renders the existing values and saves an update', async () => {
    updateMock.mockResolvedValue({ ...baseEntry, title: 'Renamed' })
    const onSaved = vi.fn()
    const user = userEvent.setup()
    render(
      <BusyEntryModal
        mode="edit"
        entry={baseEntry}
        canDelete
        onClose={() => {}}
        onSaved={onSaved}
        onDeleted={() => {}}
      />
    )
    const title = screen.getByLabelText(/title/i) as HTMLInputElement
    expect(title.value).toBe('Conference')
    await user.clear(title)
    await user.type(title, 'Renamed')
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    expect(updateMock).toHaveBeenCalledWith('b1', expect.objectContaining({ title: 'Renamed' }))
    expect(onSaved).toHaveBeenCalled()
  })

  it('hides the Delete button when the row is not the viewer\'s own', () => {
    render(
      <BusyEntryModal
        mode="edit"
        entry={baseEntry}
        canDelete={false}
        onClose={() => {}}
        onSaved={() => {}}
        onDeleted={() => {}}
      />
    )
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument()
  })

  it('calls deleteStaffAvailability + onDeleted when Delete is confirmed', async () => {
    deleteMock.mockResolvedValue(undefined)
    const onDeleted = vi.fn()
    const user = userEvent.setup()
    // happy-dom doesn't define window.confirm by default; install one.
    window.confirm = vi.fn(() => true)
    render(
      <BusyEntryModal
        mode="edit"
        entry={baseEntry}
        canDelete
        onClose={() => {}}
        onSaved={() => {}}
        onDeleted={onDeleted}
      />
    )
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(deleteMock).toHaveBeenCalledWith('b1')
    expect(onDeleted).toHaveBeenCalledWith('b1')
  })
})
