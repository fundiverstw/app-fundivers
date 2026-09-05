import { describe, it, expect } from 'vitest'
import {
  computeShutdownReadiness, readyToShutDown, BACKUP_FRESH_HOURS,
  type ReadinessCheck, type ReadinessInput,
} from './shutdown-readiness'

const NOW = new Date('2026-09-05T12:00:00Z')

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString()
}

function input(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    lastBackupAt:   hoursAgo(1),
    now:            NOW,
    upcomingEvents: [],
    bookings:       [],
    payments:       [],
    credits:        [],
    diverCount:     0,
    ...over,
  }
}

function check(checks: ReadinessCheck[], id: string): ReadinessCheck {
  return checks.find(c => c.id === id)!
}

describe('computeShutdownReadiness', () => {
  it('clears a shop that has settled up and just taken a backup', () => {
    const checks = computeShutdownReadiness(input())
    expect(readyToShutDown(checks)).toBe(true)
  })

  it('warns when the backup is old, and when there has never been one', () => {
    expect(check(computeShutdownReadiness(input({ lastBackupAt: hoursAgo(BACKUP_FRESH_HOURS + 1) })), 'backup').level)
      .toBe('warn')
    expect(check(computeShutdownReadiness(input({ lastBackupAt: null })), 'backup').level)
      .toBe('warn')
    expect(check(computeShutdownReadiness(input({ lastBackupAt: hoursAgo(BACKUP_FRESH_HOURS - 1) })), 'backup').level)
      .toBe('ok')
  })

  it('counts the events divers are still expecting, and names the soonest', () => {
    const checks = computeShutdownReadiness(input({
      upcomingEvents: [
        { id: 'e2', startDate: '2026-09-20' },
        { id: 'e1', startDate: '2026-09-08' },
      ],
    }))
    expect(check(checks, 'upcomingEvents')).toMatchObject({ level: 'warn', count: 2, detail: '2026-09-08' })
  })

  it('adds up what divers still owe the shop, ignoring cancelled bookings', () => {
    const checks = computeShutdownReadiness(input({
      bookings: [
        { id: 'b1', status: 'confirmed', details: { total: 3000 } },
        { id: 'b2', status: 'pending',   details: { total: 2000 } },
        // Cancelled owes nothing, whatever its total says.
        { id: 'b3', status: 'cancelled', details: { total: 9000 } },
      ] as never,
      payments: [
        { booking_id: 'b1', amount: 1000, status: 'paid' },
      ] as never,
    }))
    expect(check(checks, 'moneyOwedToShop')).toMatchObject({ level: 'warn', count: 4000 })
  })

  it('nets refunds out of what has been paid', () => {
    const checks = computeShutdownReadiness(input({
      bookings: [{ id: 'b1', status: 'confirmed', details: { total: 3000 } }] as never,
      payments: [
        { booking_id: 'b1', amount: 3000, status: 'paid' },
        { booking_id: 'b1', amount: 1000, status: 'refunded' },
      ] as never,
    }))
    // Paid 3000, refunded 1000 — the booking is 1000 short again.
    expect(check(checks, 'moneyOwedToShop').count).toBe(1000)
  })

  it('counts open credits as money the shop owes divers, and spent ones as nothing', () => {
    const checks = computeShutdownReadiness(input({
      credits: [
        { amount: 1500, status: 'open' },
        { amount: 500,  status: 'open' },
        { amount: 800,  status: 'settled' },
      ] as never,
    }))
    // Deleting the project erases the record of this, not the obligation.
    expect(check(checks, 'creditsOwedToDivers')).toMatchObject({ level: 'warn', count: 2000 })
  })

  it('counts the diver accounts that would go with the project', () => {
    const checks = computeShutdownReadiness(input({ diverCount: 74 }))
    expect(check(checks, 'divers')).toMatchObject({ level: 'warn', count: 74 })
    expect(readyToShutDown(checks)).toBe(false)
  })
})
