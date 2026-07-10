// Pure selection logic shared between the Cloudflare cron worker
// (workers/push) and its unit tests. No network, no I/O — given the world
// (bookings, payments, what's already been sent), return the reminders to
// send today.
//
// Reminder windows are spec'd by product:
//   • event reminders:   7 days, 1 day before start
//   • payment reminders: 21, 14, 7, 3, 1 days before start
//     (only fire while there's an outstanding deposit or balance)

import { t } from '../i18n'

export type ReminderKind =
  | 'event_7d' | 'event_1d'
  | 'payment_21d' | 'payment_14d' | 'payment_7d' | 'payment_3d' | 'payment_1d'

export function eventKindForDays(days: number): ReminderKind | null {
  if (days === 7) return 'event_7d'
  if (days === 1) return 'event_1d'
  return null
}

export function paymentKindForDays(days: number): ReminderKind | null {
  if (days === 21) return 'payment_21d'
  if (days === 14) return 'payment_14d'
  if (days === 7)  return 'payment_7d'
  if (days === 3)  return 'payment_3d'
  if (days === 1)  return 'payment_1d'
  return null
}

// Date-only diff in whole days. Parsed as UTC to dodge DST drift — the
// caller already supplies YYYY-MM-DD in Taipei local time.
export function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.UTC(+fromYmd.slice(0, 4), +fromYmd.slice(5, 7) - 1, +fromYmd.slice(8, 10))
  const b = Date.UTC(+toYmd.slice(0, 4),   +toYmd.slice(5, 7) - 1,   +toYmd.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

export interface ReminderInput {
  userId:              string
  eventId:             string
  eventType:           'dive' | 'course'
  eventTitle:          string
  eventStartDate:      string   // YYYY-MM-DD, Taipei local
  /** 'HH:mm' (24h) or null when source row has no start time set. */
  eventStartTimeHhmm:  string | null
  bookingStatus:       string
  totalAmount:         number
  depositAmount:       number
  paidAmount:          number
  currency:            string
  alreadySent:         ReadonlySet<ReminderKind>
}

export interface ReminderOutput {
  userId:     string
  eventId:    string
  eventType:  'dive' | 'course'
  kind:       ReminderKind
  title:      string
  body:       string
  url:        string
}

function whenLabel(days: number): string {
  return days === 1 ? 'tomorrow' : `in ${days} days`
}

export function selectReminders(today: string, inputs: ReminderInput[]): ReminderOutput[] {
  const out: ReminderOutput[] = []

  for (const r of inputs) {
    if (r.bookingStatus === 'cancelled') continue
    const days = daysBetween(today, r.eventStartDate)
    if (days < 0) continue

    const timeSuffix = r.eventStartTimeHhmm ? ` · ${r.eventStartTimeHhmm}` : ''

    const evKind = eventKindForDays(days)
    if (evKind && !r.alreadySent.has(evKind)) {
      out.push({
        userId: r.userId, eventId: r.eventId, eventType: r.eventType, kind: evKind,
        title: days === 1 ? t.push.diveTomorrow : t.push.diveInDays(days),
        body:  r.eventTitle + timeSuffix,
        url:   '/records/bookings',
      })
    }

    const payKind = paymentKindForDays(days)
    if (payKind && !r.alreadySent.has(payKind)) {
      const balanceDue = Math.max(0, r.totalAmount   - r.paidAmount)
      if (balanceDue > 0) {
        const depositDue = Math.max(0, r.depositAmount - r.paidAmount)
        const isDeposit  = depositDue > 0
        const amount     = isDeposit ? depositDue : balanceDue
        const label      = isDeposit ? t.push.deposit : t.push.balance
        out.push({
          userId: r.userId, eventId: r.eventId, eventType: r.eventType, kind: payKind,
          title: `${label} due — ${r.eventTitle}`,
          body:  `${r.currency} ${amount.toLocaleString()} · event ${whenLabel(days)}${timeSuffix}`,
          url:   '/records/payments',
        })
      }
    }
  }

  return out
}
