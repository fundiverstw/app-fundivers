import type { AppEvent } from '../types/database'

// Admins set deposit_deadline + full_payment_deadline per event. When either
// is missing on a legacy event we fall back to "7 days before start_date" so
// the registration form + emailed PDF always render concrete dates.

const FALLBACK_DAYS_BEFORE_START = 7

/** YYYY-MM-DD math via UTC arithmetic — avoids timezone drift on the date string. */
function shiftDays(yyyyMmDd: string, deltaDays: number): string {
  const d = new Date(yyyyMmDd + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

export interface EffectiveDeadlines {
  deposit_deadline: string       // YYYY-MM-DD
  full_payment_deadline: string  // YYYY-MM-DD
  /** True when the deadline came from the fallback rather than admin input. */
  deposit_is_fallback: boolean
  full_payment_is_fallback: boolean
}

/**
 * Resolve the deadlines a diver should see for an event. `start` is the
 * event's start_time (ISO timestamp) — we slice off the date portion and
 * subtract FALLBACK_DAYS_BEFORE_START as the fallback for either column.
 */
export function computeEffectiveDeadlines(event: Pick<AppEvent, 'start_time' | 'deposit_deadline' | 'full_payment_deadline'>): EffectiveDeadlines {
  const startDate = event.start_time.slice(0, 10)
  const fallback = shiftDays(startDate, -FALLBACK_DAYS_BEFORE_START)
  return {
    deposit_deadline:        event.deposit_deadline      ?? fallback,
    full_payment_deadline:   event.full_payment_deadline ?? fallback,
    deposit_is_fallback:     event.deposit_deadline      == null,
    full_payment_is_fallback: event.full_payment_deadline == null,
  }
}
