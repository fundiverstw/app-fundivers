import type { AppEvent } from '../types/database'
import { siteConfig } from '../config/site'

// Admins set full_payment_deadline per event. When missing on a legacy
// event we fall back to "N days before start_date" (N from fundive.config.ts)
// so the registration form + emailed PDF always render a concrete date.
// Deposit payment is always "ASAP" — no per-event deadline.

const FALLBACK_DAYS_BEFORE_START = siteConfig.business.paymentDeadlineFallbackDays

/** YYYY-MM-DD math via UTC arithmetic — avoids timezone drift on the date string. */
function shiftDays(yyyyMmDd: string, deltaDays: number): string {
  const d = new Date(yyyyMmDd + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

/**
 * Resolve the full-payment deadline a diver should see for an event.
 * `start_time` is the event's ISO timestamp — we slice off the date
 * portion and subtract FALLBACK_DAYS_BEFORE_START as the fallback.
 */
export function computeEffectiveFullPaymentDeadline(event: Pick<AppEvent, 'start_time' | 'full_payment_deadline'>): string {
  if (event.full_payment_deadline != null) return event.full_payment_deadline
  const startDate = event.start_time.slice(0, 10)
  return shiftDays(startDate, -FALLBACK_DAYS_BEFORE_START)
}
