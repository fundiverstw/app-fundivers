import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminNondiverOptionsPage } from './AdminNondiverOptionsPage'

const { from, toastSuccess, toastError, insert, updatePatch, deleted } = vi.hoisted(() => ({
  from: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  insert: vi.fn(),
  updatePatch: vi.fn(),
  deleted: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn() }),
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'admin1', role: 'admin' } }),
}))

function query(result: Record<string, unknown>) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order']) b[m] = () => b
  b.insert = (row: unknown) => { insert(row); return Promise.resolve({ error: null }) }
  b.update = (patch: unknown) => {
    updatePatch(patch)
    return { eq: (_c: string, id: string) => { updatePatch.mock.lastCall!.push(id); return Promise.resolve({ error: null }) } }
  }
  b.delete = () => ({ eq: (_c: string, id: string) => { deleted(id); return Promise.resolve({ error: null }) } })
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej)
  return b
}

const options = [
  {
    id: 'nd1', created_at: '2026-10-01T00:00:00Z', created_by: null,
    label: 'Snorkeler', description: 'Snorkel while the group dives',
    price: 1500, deposit_amount: 500, active: true, sort_order: 0,
  },
  {
    id: 'nd2', created_at: '2026-10-01T00:00:00Z', created_by: null,
    label: 'Boat passenger', description: null,
    price: 800, deposit_amount: null, active: false, sort_order: 1,
  },
]

beforeEach(() => {
  from.mockReset(); toastSuccess.mockReset(); toastError.mockReset()
  insert.mockReset(); updatePatch.mockReset(); deleted.mockReset()
  from.mockImplementation(() => query({ data: options, error: null }))
  vi.stubGlobal('confirm', vi.fn(() => true))
})

const renderPage = () => render(<MemoryRouter><AdminNondiverOptionsPage /></MemoryRouter>)

describe('AdminNondiverOptionsPage', () => {
  it('lists each option with its price, deposit and whether it is retired', async () => {
    renderPage()
    const snorkel = (await screen.findByText('Snorkeler')).closest('li')!
    expect(within(snorkel).getByText(/1,500/)).toBeInTheDocument()
    expect(within(snorkel).getByText(/deposit .*500/i)).toBeInTheDocument()
    expect(within(snorkel).getByText('Snorkel while the group dives')).toBeInTheDocument()

    const boat = screen.getByText('Boat passenger').closest('li')!
    expect(within(boat).getByText(/no deposit/i)).toBeInTheDocument()
    expect(within(boat).getByText(/retired/i)).toBeInTheDocument()
  })

  it('creates an option with a name, price and deposit', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Snorkeler')
    await user.click(screen.getByRole('button', { name: /new option/i }))
    await user.type(screen.getByLabelText(/^name/i), 'Freediver')
    await user.type(screen.getByLabelText(/^price/i), '2000')
    await user.type(screen.getByLabelText(/^deposit/i), '600')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(insert.mock.calls[0][0]).toMatchObject({
      label: 'Freediver', price: 2000, deposit_amount: 600, active: true, created_by: 'admin1',
    })
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('saves a blank deposit as none', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Snorkeler')
    await user.click(screen.getByRole('button', { name: /new option/i }))
    await user.type(screen.getByLabelText(/^name/i), 'Boat rider')
    await user.type(screen.getByLabelText(/^price/i), '0')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(insert.mock.calls[0][0]).toMatchObject({ price: 0, deposit_amount: null })
  })

  it('edits an existing option in place', async () => {
    const user = userEvent.setup()
    renderPage()
    const row = (await screen.findByText('Snorkeler')).closest('li')!
    await user.click(within(row).getByRole('button', { name: /edit/i }))
    const price = screen.getByLabelText(/^price/i)
    await user.clear(price)
    await user.type(price, '1800')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(updatePatch).toHaveBeenCalled())
    expect(updatePatch.mock.calls[0][0]).toMatchObject({ label: 'Snorkeler', price: 1800, deposit_amount: 500 })
    expect(updatePatch.mock.calls[0][1]).toBe('nd1')
    expect(insert).not.toHaveBeenCalled()
  })

  it('refuses to save without a price', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Snorkeler')
    await user.click(screen.getByRole('button', { name: /new option/i }))
    await user.type(screen.getByLabelText(/^name/i), 'Freediver')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(insert).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalled()
  })

  it('deletes an option after confirming', async () => {
    const user = userEvent.setup()
    renderPage()
    const row = (await screen.findByText('Snorkeler')).closest('li')!
    await user.click(within(row).getByRole('button', { name: /delete/i }))
    await waitFor(() => expect(deleted).toHaveBeenCalledWith('nd1'))
  })
})
