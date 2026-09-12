import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BookingDiscounts } from './BookingDiscounts'
import type { BookingDiscount, Discount } from '../../types/database'

const student: Discount = {
  id: 'dsc1', created_at: '', created_by: null,
  label: 'Student', description: null, kind: 'percent', value: 10,
  active: true, sort_order: 0,
}
const member: Discount = { ...student, id: 'dsc2', label: 'Member', kind: 'fixed', value: 400 }

const request = (over: Partial<BookingDiscount> = {}): BookingDiscount => ({
  id: 'req1', booking_id: 'b1', discount_id: 'dsc1', status: 'requested',
  note: null, requested_at: '2026-09-10T00:00:00Z', requested_by: 'd1',
  decided_at: null, decided_by: null, amount: null, amendment_id: null,
  ...over,
})

function renderBlock(over: Partial<Parameters<typeof BookingDiscounts>[0]> = {}) {
  const onRequest = vi.fn(async () => {})
  const onDecide = vi.fn(async () => {})
  render(
    <BookingDiscounts
      rows={[]}
      catalog={[student, member]}
      currency="NTD"
      bookingTotal={3000}
      readOnly={false}
      canDecide
      onRequest={onRequest}
      onDecide={onDecide}
      {...over}
    />,
  )
  return { onRequest, onDecide }
}

describe('BookingDiscounts', () => {
  it('says a pending request has taken nothing off yet', async () => {
    renderBlock({ rows: [request()] })
    const row = (await screen.findByText('Student')).closest('li')!
    expect(within(row).getByText(/waiting on the shop/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing comes off the balance until this is approved/i)).toBeInTheDocument()
  })

  it('shows what an approved one actually took off', async () => {
    renderBlock({ rows: [request({ status: 'approved', amount: 300, amendment_id: 'am1', decided_at: '2026-09-11T00:00:00Z' })] })
    const row = (await screen.findByText('Student')).closest('li')!
    expect(within(row).getByText(/300/)).toBeInTheDocument()
    expect(screen.queryByText(/nothing comes off the balance until this is approved/i)).not.toBeInTheDocument()
  })

  it('approves and rejects through the same row', async () => {
    const user = userEvent.setup()
    const { onDecide } = renderBlock({ rows: [request()] })
    await user.click(screen.getByRole('button', { name: /approve/i }))
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith('req1', true))
    await user.click(screen.getByRole('button', { name: /reject/i }))
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith('req1', false))
  })

  // The post-registration path. It records a request, not a grant — the row it
  // creates is decided the same way as one a diver ticked.
  it('applies a discount an admin picks, and previews what a percent takes', async () => {
    const user = userEvent.setup()
    const { onRequest } = renderBlock()
    // 10% of the booking's frozen 3000.
    expect(screen.getByRole('option', { name: /student.*300/i })).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox'), 'dsc1')
    await user.click(screen.getByRole('button', { name: /^apply$/i }))
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith('dsc1'))
  })

  it('does not offer a discount already asked for or granted', () => {
    renderBlock({ rows: [request()] })
    expect(screen.queryByRole('option', { name: /student/i })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /member/i })).toBeInTheDocument()
  })

  it('gives a staff viewer nothing to press', () => {
    renderBlock({ rows: [request()], readOnly: true })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    // They still see where the booking stands.
    expect(screen.getByText(/waiting on the shop/i)).toBeInTheDocument()
  })

  it('offers nothing on a cancelled booking, which cannot be discounted', () => {
    renderBlock({ rows: [request()], canDecide: false })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })
})
