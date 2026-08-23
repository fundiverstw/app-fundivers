import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BookingPaymentsBlock } from './BookingPaymentsBlock'
import type { ChargeLine } from '../../lib/booking-charges'
import type { Payment } from '../../types/database'

const noop = async () => {}

const baseProps = {
  payments: [],
  owed: 3200,
  paid: 0,
  pending: false,
  cancelled: false,
  readOnly: true,
  onRecord: noop,
}

describe('BookingPaymentsBlock — charge breakdown', () => {
  const charges: ChargeLine[] = [
    { kind: 'base', label: 'Base', amount: 2800 },
    { kind: 'gear', label: 'Gear: BCD', amount: 400 },
  ]

  it('renders an itemized Charges section when charges are provided', () => {
    render(<BookingPaymentsBlock {...baseProps} charges={charges} currency="NTD" />)
    expect(screen.getByText('Charges')).toBeInTheDocument()
    expect(screen.getByText('Gear: BCD')).toBeInTheDocument()
    expect(screen.getByText('NTD 400')).toBeInTheDocument()
  })

  it('omits the Charges section when no charges are provided', () => {
    render(<BookingPaymentsBlock {...baseProps} />)
    expect(screen.queryByText('Charges')).not.toBeInTheDocument()
    // The Payments section still renders.
    expect(screen.getByText('Payments')).toBeInTheDocument()
  })
})

describe('BookingPaymentsBlock — Balance', () => {
  it('shows a red owed balance when nothing is paid or credited', () => {
    render(<BookingPaymentsBlock {...baseProps} owed={3200} paid={1000} />)
    expect(screen.getByText('Balance')).toBeInTheDocument()
    expect(screen.getByText('2,200 owed')).toBeInTheDocument()
  })

  it('nets open credit against what is owed and shows a green credit balance', () => {
    render(<BookingPaymentsBlock {...baseProps} owed={3200} paid={1000} credit={2500} />)
    expect(screen.getByText('Credit (this event)')).toBeInTheDocument()
    expect(screen.getByText('2,500')).toBeInTheDocument()
    // 3200 - 1000 - 2500 = -300 → 300 credit
    expect(screen.getByText('300 credit')).toBeInTheDocument()
  })

  it('shows Settled when paid plus credit exactly covers what is owed', () => {
    render(<BookingPaymentsBlock {...baseProps} owed={3200} paid={3200} />)
    expect(screen.getByText('Settled ✓')).toBeInTheDocument()
  })

  it('shows no amount owed on a cancelled booking, even with a positive frozen owed', () => {
    // A cancelled event: the diver owes nothing further. The 2,200 that owed −
    // paid would otherwise show must not appear as a balance due.
    render(<BookingPaymentsBlock {...baseProps} owed={3200} paid={1000} cancelled />)
    expect(screen.getByText('Settled ✓')).toBeInTheDocument()
    expect(screen.queryByText('2,200 owed')).not.toBeInTheDocument()
  })

  it('treats a plain overpayment as a credit owed to the diver', () => {
    // owed 8,150, paid 8,700, no awarded credit row → 550 credit.
    render(<BookingPaymentsBlock {...baseProps} owed={8150} paid={8700} />)
    expect(screen.getByText('550 credit')).toBeInTheDocument()
    expect(screen.queryByText(/overpaid/i)).not.toBeInTheDocument()
  })

  it('shows a discount amendment in the breakdown so it ties out to Owed', () => {
    // The reported case: charged 8,950, −800 "2 person discount", paid 8,700.
    render(
      <BookingPaymentsBlock
        {...baseProps}
        owed={8150}
        paid={8700}
        charges={[{ kind: 'base', label: 'Base', amount: 8950 }]}
        amendments={[{ label: '2 person discount', amount: -800 }]}
        currency="TWD"
      />,
    )
    expect(screen.getByText('2 person discount')).toBeInTheDocument()
    expect(screen.getByText('−TWD 800')).toBeInTheDocument()
    // Breakdown total equals Owed, and the 550 overpayment reads as credit.
    expect(screen.getByText('TWD 8,150')).toBeInTheDocument()
    expect(screen.getByText('550 credit')).toBeInTheDocument()
  })
})


describe('BookingPaymentsBlock — payment reference', () => {
  const editable = { ...baseProps, readOnly: false }

  // Without a reference, "Paid 3,600" is a claim nobody can check against a
  // bank statement -- which is the whole reason a diver's payment can end up
  // disputed with no way to settle it.
  it('refuses to record a payment with no receipt or transaction number', async () => {
    const onRecord = vi.fn(async () => {})
    const user = userEvent.setup()
    render(<BookingPaymentsBlock {...editable} onRecord={onRecord} />)

    await user.type(screen.getByPlaceholderText(/paid amount/i), '3600')
    await user.click(screen.getByRole('button', { name: /^record payment$/i }))

    expect(onRecord).not.toHaveBeenCalled()
    expect(screen.getByText(/receipt or transaction number is required/i)).toBeInTheDocument()
  })

  it('passes the trimmed reference through when one is given', async () => {
    const onRecord = vi.fn(async () => {})
    const user = userEvent.setup()
    render(<BookingPaymentsBlock {...editable} onRecord={onRecord} />)

    await user.type(screen.getByPlaceholderText(/paid amount/i), '3600')
    await user.type(screen.getByLabelText(/^reference$/i), '  PAYPAL-8H21K  ')
    await user.click(screen.getByRole('button', { name: /^record payment$/i }))

    expect(onRecord).toHaveBeenCalledWith(3600, 'Payment', 'PAYPAL-8H21K')
  })

  it('shows the reference and the admin who recorded each payment', () => {
    const payments = [{
      id: 'p1', created_at: '2026-08-14T02:00:00Z', user_id: 'u1', booking_id: 'b1',
      amount: 3600, currency: 'TWD', status: 'paid', method: 'bank_transfer',
      note: 'Balance', reference: 'TW-4417', recorded_by: 'admin-2',
    }] as Payment[]
    render(
      <BookingPaymentsBlock
        {...baseProps}
        payments={payments}
        actorName={(id) => (id === 'admin-2' ? 'Bea Boss' : 'system')}
      />,
    )
    expect(screen.getByText(/ref TW-4417/)).toBeInTheDocument()
    expect(screen.getByText(/by Bea Boss/)).toBeInTheDocument()
  })

  it('names who cancelled a booking, on the booking they cancelled', () => {
    render(
      <BookingPaymentsBlock
        {...baseProps}
        cancelled
        cancelledAt="2026-08-20T02:00:00Z"
        cancelledBy="admin-3"
        actorName={(id) => (id === 'admin-3' ? 'Cal Crew' : 'system')}
      />,
    )
    expect(screen.getByText(/Cancelled Aug 20/)).toBeInTheDocument()
    expect(screen.getByText(/by Cal Crew/)).toBeInTheDocument()
  })
})
