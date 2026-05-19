import type { AppEvent } from '../types/database'

// Admins set full_payment_deadline per event. When missing on a legacy
// event we fall back to "7 days before start_date" so the registration
// form + emailed PDF always render a concrete date. Deposit payment is
// always "ASAP" — no per-event deadline.

const FALLBACK_DAYS_BEFORE_START = 7

/** YYYY-MM-DD math via UTC arithmetic — avoids timezone drift on the date string. */
function shiftDays(yyyyMmDd: string, deltaDays: number): string {
  const d = new Date(yyyyMmDd + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

export interface EffectiveDeadlines {
  full_payment_deadline: string  // YYYY-MM-DD
  /** True when the deadline came from the fallback rather than admin input. */
  full_payment_is_fallback: boolean
}

/**
 * Resolve the deadline a diver should see for an event. `start_time` is
 * the event's ISO timestamp — we slice off the date portion and
 * subtract FALLBACK_DAYS_BEFORE_START as the fallback.
 */
export function computeEffectiveDeadlines(event: Pick<AppEvent, 'start_time' | 'full_payment_deadline'>): EffectiveDeadlines {
  const startDate = event.start_time.slice(0, 10)
  const fallback = shiftDays(startDate, -FALLBACK_DAYS_BEFORE_START)
  return {
    full_payment_deadline:    event.full_payment_deadline ?? fallback,
    full_payment_is_fallback: event.full_payment_deadline == null,
  }
}
