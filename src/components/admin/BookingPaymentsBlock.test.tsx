import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BookingPaymentsBlock } from './BookingPaymentsBlock'
import type { ChargeLine } from '../../lib/booking-charges'

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
