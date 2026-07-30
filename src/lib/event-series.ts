import { supabase } from './supabase'
import { addIsoDays, diffIsoDays } from './dates'
import { usesCourseDays } from './event-kinds'
import { occurrenceDates, datesAfter, type RecurrenceRule } from './recurrence'
import { eventPayloadFromForm, type FormState } from '../components/admin/event-form-state'
import { saveEventRelations } from './event-relations'
import { fetchEventsForBookings } from './events'
import { cancelEventAndFollowUp } from './event-cancellation'
import type { EventRow, EventSeries } from '../types/database'

// Turning one filled-in event form plus a recurrence rule into a batch of real
// `events` rows, and reading a batch back.
//
// The whole feature rests on one idea: an occurrence differs from the template
// ONLY by a whole-day offset. Shift every date the form carries by the same
// delta and both temporal shapes fall out for free — a dive moves its envelope,
// a course moves each entry in its day list — with no branch on kind beyond
// picking which field holds the anchor.

/** Every date field on the form, so none is left pointing at the template. */
const SHIFTED_FIELDS = ['start_date', 'end_date', 'cancel_date', 'full_payment_deadline'] as const

/**
 * The date an occurrence is identified by: the start of the envelope, or the
 * first day a course runs. Null when the form has no date yet.
 */
export function seriesAnchor(form: FormState): string | null {
  if (usesCourseDays(form.type)) {
    const days = form.courseDays.filter(Boolean).sort()
    return days[0] ?? null
  }
  return form.start_date || null
}

/**
 * The template form re-dated onto `target`.
 *
 * cancel_date and full_payment_deadline shift with everything else. They are
 * absolute dates derived from the event's own start ("cancel by the Thursday
 * before"), so leaving them behind would give occurrence eight a cancellation
 * deadline months in its past — silently, and only noticed when a diver was
 * refused a refund.
 */
export function shiftFormToDate(form: FormState, target: string): FormState {
  const anchor = seriesAnchor(form)
  if (!anchor) return form
  const delta = diffIsoDays(anchor, target)
  if (delta === 0) return form

  const next: FormState = { ...form }
  for (const field of SHIFTED_FIELDS) {
    const value = next[field]
    if (value) next[field] = addIsoDays(value, delta)
  }
  // A course's days move as a block, keeping the gaps between them: a
  // Sat/Sun/next-Sat course stays exactly that shape a week later.
  next.courseDays = form.courseDays.map(d => (d ? addIsoDays(d, delta) : d))
  return next
}

export interface CreateSeriesArgs {
  form: FormState
  rule: RecurrenceRule
  createdBy: string | null
  label?: string
  /** Cars to assign to every occurrence, as the create form already does for one. */
  assignVehicles?: (eventId: string, type: FormState['type']) => Promise<void>
}

export interface CreateSeriesResult {
  seriesId: string
  /** Occurrence ids in date order; the first is the template's own date. */
  eventIds: string[]
  dates: string[]
  /** Occurrences whose junction rows (rooms / add-ons / cars) failed to save.
   *  The events exist and are correct; only the extras need a manual fix. */
  relationFailures: string[]
}

/**
 * Insert the series and its occurrences.
 *
 * The events go in as ONE insert so the batch is all-or-nothing: a partial
 * series — some Saturdays bookable, some not — is worse than none, and PostgREST
 * gives us a single statement for free here. Junctions and cars are written
 * afterwards per occurrence and reported rather than thrown, because an event
 * missing its add-ons is fixable by editing it, while rolling back eight
 * already-inserted events is not.
 */
export async function createEventSeries(args: CreateSeriesArgs): Promise<CreateSeriesResult> {
  const { form, rule, createdBy, label, assignVehicles } = args
  const anchor = seriesAnchor(form)
  if (!anchor) throw new Error('the event needs a date before it can repeat')

  const dates = occurrenceDates(rule, anchor)

  const { data: series, error: seriesErr } = await supabase
    .from('event_series')
    .insert({
      kind: form.type,
      freq: rule.freq,
      interval: rule.interval,
      weekdays: rule.freq === 'weekly' ? (rule.weekdays ?? null) : null,
      label: label?.trim() || null,
      created_by: createdBy,
    } as never)
    .select('id')
    .single()
  if (seriesErr) throw seriesErr
  const seriesId = (series as { id: string }).id

  const rows = dates.map(date => ({
    id: crypto.randomUUID(),
    ...eventPayloadFromForm(shiftFormToDate(form, date)),
    series_id: seriesId,
  }))
  const { error: eventsErr } = await supabase.from('events').insert(rows as never)
  if (eventsErr) {
    // Nothing points at the series now, so leave no orphan rule behind.
    await supabase.from('event_series').delete().eq('id', seriesId)
    throw eventsErr
  }

  const relationFailures: string[] = []
  for (const row of rows) {
    const relError = await saveEventRelations(row.id, form)
    if (relError) { relationFailures.push(row.id); continue }
    if (assignVehicles) {
      try { await assignVehicles(row.id, form.type) } catch { relationFailures.push(row.id) }
    }
  }

  return { seriesId, eventIds: rows.map(r => r.id), dates, relationFailures }
}

export async function fetchSeries(seriesId: string): Promise<EventSeries | null> {
  const { data, error } = await supabase
    .from('event_series').select('*').eq('id', seriesId).maybeSingle()
  if (error) throw error
  return data ?? null
}

/** The rule as the recurrence lib wants it. */
export function ruleFromSeries(series: EventSeries, count: number): RecurrenceRule {
  return {
    freq: series.freq,
    interval: series.interval,
    weekdays: (series.weekdays ?? undefined) as RecurrenceRule['weekdays'],
    count,
  }
}

/** Every occurrence of a series, in date order. */
export async function fetchSeriesOccurrences(seriesId: string): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from('events').select('*').eq('series_id', seriesId)
  if (error) throw error
  return sortOccurrences((data ?? []) as EventRow[])
}

/**
 * Occurrences ordered by the date they happen on, whatever their shape. A
 * course's start lives in course_days rather than start_date, so ordering on
 * start_date alone would scatter course series arbitrarily.
 */
export function sortOccurrences(rows: EventRow[]): EventRow[] {
  return [...rows].sort((a, b) => (occurrenceDate(a) ?? '').localeCompare(occurrenceDate(b) ?? ''))
}

/** The date an occurrence row is anchored on. */
export function occurrenceDate(row: EventRow): string | null {
  if (usesCourseDays(row.kind)) {
    const days = (row.course_days ?? []).filter(Boolean).map(d => String(d).slice(0, 10)).sort()
    return days[0] ?? null
  }
  return row.start_date ?? null
}

/**
 * Add `howMany` more occurrences to an existing series, continuing its pattern
 * from the last one. The template for the new rows is the last occurrence
 * itself, so any edit the shop has since made to the series carries forward.
 */
export interface ExtendSeriesResult {
  eventIds: string[]
  dates: string[]
}

export async function extendSeries(
  seriesId: string, howMany: number, formFromRow: (row: EventRow) => FormState,
): Promise<ExtendSeriesResult> {
  const series = await fetchSeries(seriesId)
  if (!series) throw new Error('that series no longer exists')
  const occurrences = await fetchSeriesOccurrences(seriesId)
  const last = occurrences[occurrences.length - 1]
  if (!last) throw new Error('that series has no occurrences to continue from')
  const lastDate = occurrenceDate(last)
  if (!lastDate) throw new Error('the last occurrence has no date to continue from')

  const rule = ruleFromSeries(series, howMany)
  const dates = datesAfter(rule, lastDate, howMany)
  const template = formFromRow(last)

  const rows = dates.map(date => ({
    id: crypto.randomUUID(),
    ...eventPayloadFromForm(shiftFormToDate(template, date)),
    series_id: seriesId,
  }))
  const { error } = await supabase.from('events').insert(rows as never)
  if (error) throw error

  for (const row of rows) await saveEventRelations(row.id, template)
  return { eventIds: rows.map(r => r.id), dates }
}

// ── Series-wide operations ───────────────────────────────────────────────────

/** Occurrences strictly after `fromDate` that aren't already cancelled. */
export function laterOccurrences(rows: EventRow[], fromDate: string): EventRow[] {
  return sortOccurrences(rows).filter(row => {
    const date = occurrenceDate(row)
    return !!date && date > fromDate && !row.cancelled_at
  })
}

/**
 * Date fields are deliberately NOT carried when an edit is pushed to later
 * occurrences.
 *
 * Copying them would collapse every remaining Saturday onto the edited one's
 * date — the single worst thing this feature could do. The deadlines go with
 * them because they are derived from each occurrence's own start: keeping the
 * edited event's cancel_date would put occurrence eight's deadline in the past,
 * the same trap shiftFormToDate exists to avoid.
 */
const PER_OCCURRENCE_FIELDS = [
  'start_date', 'end_date', 'course_days', 'cancel_date', 'full_payment_deadline',
] as const

/** The edited event's settings, minus anything specific to its own date. */
export function sharedPatchFromForm(form: FormState): Record<string, unknown> {
  const payload = { ...eventPayloadFromForm(form) }
  for (const field of PER_OCCURRENCE_FIELDS) delete payload[field]
  return payload
}

/**
 * Push one occurrence's settings onto every later occurrence in its series.
 * Returns how many rows were touched.
 */
export async function applyToLaterOccurrences(
  seriesId: string, fromDate: string, form: FormState,
): Promise<number> {
  const rows = await fetchSeriesOccurrences(seriesId)
  const targets = laterOccurrences(rows, fromDate)
  if (targets.length === 0) return 0
  const { error } = await supabase
    .from('events')
    .update(sharedPatchFromForm(form) as never)
    .in('id', targets.map(r => r.id))
  if (error) throw error
  return targets.length
}

/**
 * Cancel every later occurrence in the series, each with the notification and
 * the diver credits a single cancellation does.
 *
 * Sequential on purpose: each cancellation writes credit rows and fires two
 * notification backends, and firing fifty of those at once is how you get rate
 * limits and half-sent batches. A failure stops the run and reports what got
 * through, so the shop knows exactly where to resume.
 */
export interface CancelLaterResult {
  cancelled: number
  credited: number
  creditedAmount: number
  /** Occurrences whose credits failed after their cancellation committed. */
  creditFailures: number
  /** Set when the run stopped early; the count above is what did land. */
  stoppedBy: unknown
}

export async function cancelLaterOccurrences(args: {
  seriesId: string
  fromDate: string
  createdBy: string | null
}): Promise<CancelLaterResult> {
  const { seriesId, fromDate, createdBy } = args
  const targets = laterOccurrences(await fetchSeriesOccurrences(seriesId), fromDate)

  // The credit maths needs a built AppEvent (currency, price, the whole
  // envelope), not the raw row — so go through the same builder every other
  // surface uses rather than hand-rolling a conversion here.
  const built = await fetchEventsForBookings(targets.map(r => r.id))

  const result: CancelLaterResult = {
    cancelled: 0, credited: 0, creditedAmount: 0, creditFailures: 0, stoppedBy: null,
  }
  for (const row of targets) {
    const event = built.get(row.id)
    if (!event) continue
    try {
      const one = await cancelEventAndFollowUp({ event, createdBy })
      result.cancelled += 1
      result.credited += one.credited
      result.creditedAmount += one.creditedAmount
      if (one.creditError) result.creditFailures += 1
    } catch (err) {
      result.stoppedBy = err
      break
    }
  }
  return result
}

/** The series an event belongs to, or null for a one-off. */
export async function fetchEventSeriesId(eventId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('events').select('series_id').eq('id', eventId).maybeSingle()
  if (error) throw error
  return (data as { series_id: string | null } | null)?.series_id ?? null
}
