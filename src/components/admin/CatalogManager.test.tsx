import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CatalogManager, type CatalogField } from './CatalogManager'
import { mockQueryBuilder } from '../../../tests/test-utils'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

beforeEach(() => {
  from.mockReset()
})

interface Row {
  _id: string
  nickname: string | null
  price: number | null
}

const FIELDS: CatalogField<Row>[] = [
  { key: 'nickname', label: 'Display name', type: 'text', required: true },
  { key: 'price',        label: 'Price', type: 'number' },
]

function renderManager(seed: Row[]) {
  // Single shared builder lets us spy on whichever mutating call the test
  // exercises while still serving the initial select() with seed data.
  const inserts: unknown[] = []
  const updates: { payload: unknown; eq: [string, unknown] }[] = []
  const deletes: [string, unknown][] = []

  from.mockImplementation(() => {
    const builder = mockQueryBuilder({ data: seed }) as Record<string, unknown>
    builder.insert = (payload: unknown) => {
      inserts.push(payload)
      return Promise.resolve({ error: null })
    }
    builder.update = (payload: unknown) => ({
      eq: (col: string, val: unknown) => {
        updates.push({ payload, eq: [col, val] })
        return Promise.resolve({ error: null })
      },
    })
    builder.delete = () => ({
      eq: (col: string, val: unknown) => {
        deletes.push([col, val])
        return Promise.resolve({ error: null })
      },
    })
    return builder
  })

  render(
    <CatalogManager<Row>
      title="Test catalog"
      table="things"
      noun="thing"
      fields={FIELDS}
      rowLabel={r => r.nickname ?? r._id}
      rowDetail={r => r.price != null ? `${r.price}` : null}
    />
  )

  return { inserts, updates, deletes }
}

describe('CatalogManager', () => {
  it('lists existing rows with display name + detail', async () => {
    renderManager([
      { _id: 'a', nickname: 'Twin', price: 1000 },
      { _id: 'b', nickname: 'Single', price: 500 },
    ])

    expect(await screen.findByText('Twin')).toBeInTheDocument()
    expect(screen.getByText('Single')).toBeInTheDocument()
    expect(screen.getByText('1000')).toBeInTheDocument()
  })

  it('opens the create form, validates required fields, and inserts a new row with auto _id', async () => {
    const { inserts } = renderManager([])
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /new thing/i }))

    // Required validation kicks in before we hit the network.
    await user.click(screen.getByRole('button', { name: /create thing/i }))
    expect(await screen.findByText(/Display name is required/i)).toBeInTheDocument()
    expect(inserts).toHaveLength(0)

    // Fill in and submit.
    await user.type(screen.getByLabelText(/display name/i), 'Suite')
    await user.type(screen.getByLabelText(/price/i), '7500')
    await user.click(screen.getByRole('button', { name: /create thing/i }))

    await waitFor(() => expect(inserts).toHaveLength(1))
    const payload = inserts[0] as Record<string, unknown>
    expect(typeof payload._id).toBe('string')
    expect(payload._id).toMatch(/[0-9a-f-]{36}/)
    expect(payload.nickname).toBe('Suite')
    expect(payload.price).toBe(7500)
    // List grew by one optimistically without a refetch.
    expect(screen.getByText('Suite')).toBeInTheDocument()
  })

  it('opens the edit form prefilled and updates by _id without sending _id in the payload', async () => {
    const { updates } = renderManager([{ _id: 'r-1', nickname: 'Twin', price: 1000 }])
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /edit/i }))
    const nameInput = screen.getByLabelText(/display name/i) as HTMLInputElement
    expect(nameInput.value).toBe('Twin')

    await user.clear(nameInput)
    await user.type(nameInput, 'Twin Ocean View')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updates).toHaveLength(1))
    const { payload, eq } = updates[0]
    expect(eq).toEqual(['_id', 'r-1'])
    expect((payload as Record<string, unknown>).nickname).toBe('Twin Ocean View')
    expect((payload as Record<string, unknown>)._id).toBeUndefined()
  })

  it('deletes after confirmation and removes the row from the list', async () => {
    const { deletes } = renderManager([{ _id: 'r-1', nickname: 'Twin', price: 1000 }])
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /^delete$/i }))
    // Confirm modal — second Delete button inside the dialog.
    const confirmButtons = await screen.findAllByRole('button', { name: /^delete$/i })
    await user.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(() => expect(deletes).toHaveLength(1))
    expect(deletes[0]).toEqual(['_id', 'r-1'])
    await waitFor(() => expect(screen.queryByText('Twin')).not.toBeInTheDocument())
  })
})
