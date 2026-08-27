import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { BalancePanel } from './AdminUsersPage'
import { buildDiverStatement } from '../../lib/diver-statement'
import { t } from '../../i18n'
import type { AppEvent, Booking, ChargeLine, Credit, Payment } from '../../types/database'

const us = t.admin.users

// Marius Drop's real shape, and the one that made the summary read as broken:
// three live bookings paid to the cent, plus two courses whose events were
// called off with 2,500 paid on each. Charged and Paid square exactly, and the
// 5,000 he is owed comes from bookings that left both figures together.
const T = (d: number) => `2026-08-${String(d).padStart(2, '0')}T00:00:00Z`

const booking = (id: string, total: number, status = 'confirmed'): Booking => ({
  id, created_at: T(1), user_id: 'diver-1', event_id: `ev-${id}`, status,
  notes: null, details: { total }, refund_requested_at: null,
  cancellation_settled_at: null, cancellation_settled_by: null, cancellation_settled_note: null,
  cancelled_at: status === 'cancelled' ? T(27) : null, cancelled_by: null,
  status_before_event_cancel: null,
  group_id: null, payer_id: null, continues_booking_id: null, attend_days: null,
} as unknown as Booking)

const payment = (id: string, booking_id: string, amount: number): Payment => ({
  id, created_at: T(2), user_id: 'diver-1', booking_id, amount, currency: 'TWD',
  status: 'paid', method: 'cash', note: null, recorded_by: null, reference: null,
} as unknown as Payment)

const credit = (id: string, booking_id: string, amount: number): Credit => ({
  id, created_at: T(28), user_id: 'diver-1', booking_id, amount, currency: 'TWD',
  reason: 'cancelled', status: 'open', created_by: null,
  settled_at: null, settled_note: null, settled_by: null, source: 'event_cancellation',
} as unknown as Credit)

const bookings = [
  booking('live-1', 4300), booking('live-2', 2950), booking('live-3', 15200),
  booking('off-1', 5440, 'cancelled'), booking('off-2', 7240, 'cancelled'),
]
const payments = [
  payment('p1', 'live-1', 4300), payment('p2', 'live-2', 2950), payment('p3', 'live-3', 15200),
  payment('p4', 'off-1', 2500), payment('p5', 'off-2', 2500),
]
const credits = [credit('c1', 'off-1', 2500), credit('c2', 'off-2', 2500)]

function renderPanel(over: { payments?: Payment[]; credits?: Credit[] } = {}) {
  const statement = buildDiverStatement({
    bookings,
    payments: over.payments ?? payments,
    credits: over.credits ?? credits,
    amendmentsByBooking: new Map(),
  })
  render(
    <BalancePanel
      statement={statement}
      spendable={5000}
      credits={over.credits ?? credits}
      bookings={bookings.map(b => ({ ...b, event: null as AppEvent | null, charges: [] as ChargeLine[] }))}
      actorNames={new Map()}
      applyTargets={[]}
      readOnly
      onCreate={vi.fn()}
      onCharge={vi.fn()}
      onApply={vi.fn()}
    />
  )
  return statement
}

describe('BalancePanel', () => {
  it('closes at what the shop owes, with the three figures behind it', () => {
    const statement = renderPanel()
    expect(statement.balance).toBe(5000)

    const charged = screen.getByText(us.totalCharged).closest('div')!
    expect(within(charged).getByText('22,450')).toBeInTheDocument()
    const paid = screen.getByText(t.payments.paid).closest('div')!
    expect(within(paid).getByText('22,450')).toBeInTheDocument()
  })

  // The nitpick this row exists to answer: Charged and Paid square to the
  // penny while a credit sits beside them, which reads as an error until the
  // money that left both figures together is named.
  it('names where the credit came from, so it is not money out of nowhere', () => {
    renderPanel()

    const row = screen.getByText(us.fromCancelled).closest('div')!
    expect(within(row).getByText('5,000')).toBeInTheDocument()
    expect(screen.getByText(us.fromCancelledNote)).toBeInTheDocument()
  })

  it('stays quiet for a diver with nothing cancelled', () => {
    renderPanel({
      payments: payments.filter(p => p.booking_id!.startsWith('live')),
      credits: [],
    })
    expect(screen.queryByText(us.fromCancelled)).not.toBeInTheDocument()
  })

  // Cash that went back off-app is not money sitting in a credit balance, so
  // the row must not claim it did.
  it('counts only what the shop still holds, not a payment already refunded', () => {
    renderPanel({
      payments: [
        ...payments,
        { ...payment('p6', 'off-1', 2500), status: 'refunded' } as Payment,
      ],
      credits: [credit('c2', 'off-2', 2500)],
    })

    const row = screen.getByText(us.fromCancelled).closest('div')!
    expect(within(row).getByText('2,500')).toBeInTheDocument()
  })
})
