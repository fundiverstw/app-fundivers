// Which staff member generated which revenue, over a season.
//
// Pure TS (no Supabase, no DOM) so the attribution rule is unit-testable; the
// admin page batches the reads and hands the rows in.
//
// The shop's rule, and the reason each half of it exists:
//
//   - Only an instructor can deliver a course, so only a rostered instructor
//     earns from one. A guide on a course is assisting.
//   - An instructor or a guide can lead divers on anything else, so either
//     earns from a dive or an adventure.
//   - Support never earns, on any kind. It is an unpaid role.
//   - When two people qualify on the same event -- a course big enough to
//     split between instructors, a dive needing a second guide -- they split
//     its revenue evenly.
//   - Crew who are not compensated at all (the owner, volunteer divemasters)
//     keep their duty credit but take no share, and are left out of the
//     denominator. Counting them would silently dilute every paid guide's
//     share of every dive they were on, with nothing about the result looking
//     wrong.
//
// Revenue is money actually received -- `paid` minus `refunded` across the
// event's confirmed bookings, via netPaidByBooking, the same sum every other
// money surface uses. Not what the event was sold for: a deposit on a course
// that has not run yet is not revenue anybody has generated.
import { netPaidByBooking } from './payments'
import { isInstructorLed, type EventKind } from './event-kinds'
import type { DutyRole } from '../types/database'

export interface RevenueEvent {
  id: string
  kind: EventKind
  admin_title: string | null
  display_title: string | null
  start_date: string | null
  end_date: string | null
  course_days: string[] | null
  cancelled_at: string | null
}

export interface RevenueDuty {
  event_id: string | null
  assignee_id: string
  role: DutyRole
}

export interface RevenueBooking {
  id: string
  event_id: string | null
  status: string
}

export interface RevenuePayment {
  booking_id: string | null
  status: string | null
  amount: number
}

export interface RevenuePerson {
  id: string
  name: string | null
  nickname: string | null
  compensated: boolean
}

/** True when someone working `role` on a `kind` event earns a share of it. */
export function earnsRevenue(kind: EventKind, role: DutyRole): boolean {
  if (role === 'support') return false
  if (isInstructorLed(kind)) return role === 'instructor'
  return role === 'instructor' || role === 'guide'
}

/** One event as it appears in a person's season, already carrying their cut. */
export interface EventRevenue {
  eventId: string
  kind: EventKind
  title: string
  /** The course type ("OW", "AOW", "EANx") — events.admin_title. Null on kinds
   *  that are not taught, where admin_title is a free-text dive name. */
  category: string | null
  firstDay: string | null
  lastDay: string | null
  /** YYYY-MM of the first day — the month the event is booked to. */
  month: string | null
  /** Confirmed bookings on the event. Not divided between crew: it is a count
   *  of who they worked with, not a share of anything. */
  students: number
  /** Net collected across the event's confirmed bookings. */
  collected: number
  /** Compensated crew who earn from this event. */
  earnerIds: string[]
  /** collected / earnerIds.length — one person's cut. Zero when nobody earns. */
  share: number
  /** True when the event's last day has passed in the shop's timezone. */
  completed: boolean
}

export interface MonthRevenue {
  month: string
  taughtEvents: number
  taughtStudents: number
  ledEvents: number
  ledDivers: number
  students: number
  collected: number
}

export interface CategoryRevenue {
  kind: EventKind
  /** Course type, or the kind's own label for events that are not taught. */
  category: string
  events: number
  students: number
  collected: number
}

export interface PersonRevenue {
  personId: string
  name: string
  months: MonthRevenue[]
  categories: CategoryRevenue[]
  events: EventRevenue[]
  completed: { events: number; students: number; collected: number }
  upcoming: { events: number; students: number; collected: number }
}

export interface StaffRevenueReport {
  season: number
  people: PersonRevenue[]
  /** Events that took money but had nobody rostered who could earn from them.
   *  Their revenue belongs to no one, so it is held here rather than silently
   *  dropped — otherwise the per-person columns quietly fail to reconcile with
   *  what the shop actually took. */
  unattributed: {
    collected: number
    events: EventRevenue[]
  }
}

export interface BuildStaffRevenueInput {
  season: number
  events: RevenueEvent[]
  duties: RevenueDuty[]
  bookings: RevenueBooking[]
  payments: RevenuePayment[]
  people: RevenuePerson[]
  /** Today in the shop's timezone, YYYY-MM-DD — pass todayIso(). */
  today: string
}

function displayName(p: RevenuePerson): string {
  return p.nickname || p.name || p.id
}

/** First and last calendar day of an event, whichever columns carry them. */
export function eventSpan(e: RevenueEvent): { first: string | null; last: string | null } {
  const days = (e.course_days ?? []).filter(Boolean).slice().sort()
  if (days.length) return { first: days[0], last: days[days.length - 1] }
  const first = e.start_date ?? null
  return { first, last: e.end_date ?? first }
}

function titleOf(e: RevenueEvent): string {
  return e.display_title || e.admin_title || e.id
}

/**
 * Roll duties, bookings and payments up into per-person season figures.
 *
 * Cancelled events are dropped entirely — a cancelled event's money is a
 * refund story, told by the Audits page, not revenue anyone generated.
 * Cancelled and pending bookings are dropped for the same reason: only a
 * confirmed seat is a sale.
 */
export function buildStaffRevenue(input: BuildStaffRevenueInput): StaffRevenueReport {
  const { season, today } = input
  const personById = new Map(input.people.map(p => [p.id, p]))
  const netByBooking = netPaidByBooking(
    input.payments.map(p => ({ booking_id: p.booking_id, status: p.status, amount: p.amount })),
  )

  const confirmedByEvent = new Map<string, { students: number; collected: number }>()
  for (const b of input.bookings) {
    if (b.status !== 'confirmed' || !b.event_id) continue
    const bucket = confirmedByEvent.get(b.event_id) ?? { students: 0, collected: 0 }
    bucket.students += 1
    bucket.collected += netByBooking.get(b.id) ?? 0
    confirmedByEvent.set(b.event_id, bucket)
  }

  const dutiesByEvent = new Map<string, RevenueDuty[]>()
  for (const d of input.duties) {
    if (!d.event_id) continue
    const list = dutiesByEvent.get(d.event_id)
    if (list) list.push(d)
    else dutiesByEvent.set(d.event_id, [d])
  }

  const perPerson = new Map<string, EventRevenue[]>()
  const unattributedEvents: EventRevenue[] = []

  for (const e of input.events) {
    if (e.cancelled_at) continue
    const { first, last } = eventSpan(e)
    if (!first || first.slice(0, 4) !== String(season)) continue

    const money = confirmedByEvent.get(e.id) ?? { students: 0, collected: 0 }

    const earnerIds = [...new Set(
      (dutiesByEvent.get(e.id) ?? [])
        .filter(d => earnsRevenue(e.kind, d.role))
        .map(d => d.assignee_id)
        .filter(id => personById.get(id)?.compensated),
    )].sort()

    const row: EventRevenue = {
      eventId: e.id,
      kind: e.kind,
      title: titleOf(e),
      category: isInstructorLed(e.kind) ? e.admin_title : null,
      firstDay: first,
      lastDay: last,
      month: first.slice(0, 7),
      students: money.students,
      collected: money.collected,
      earnerIds,
      share: earnerIds.length ? money.collected / earnerIds.length : 0,
      completed: !!last && last < today,
    }

    if (!earnerIds.length) {
      // Only worth surfacing when there is money to account for. An event
      // nobody booked and nobody was rostered for is not a roster gap.
      if (money.collected !== 0 || money.students > 0) unattributedEvents.push(row)
      continue
    }
    for (const id of earnerIds) {
      const list = perPerson.get(id)
      if (list) list.push(row)
      else perPerson.set(id, [row])
    }
  }

  const people: PersonRevenue[] = [...perPerson.entries()].map(([personId, events]) => {
    const sorted = [...events].sort((a, b) => (a.firstDay ?? '').localeCompare(b.firstDay ?? ''))
    const done = sorted.filter(e => e.completed)

    const months = new Map<string, MonthRevenue>()
    const categories = new Map<string, CategoryRevenue>()
    for (const e of done) {
      if (e.month) {
        const m = months.get(e.month) ?? {
          month: e.month,
          taughtEvents: 0, taughtStudents: 0,
          ledEvents: 0, ledDivers: 0,
          students: 0, collected: 0,
        }
        if (isInstructorLed(e.kind)) { m.taughtEvents += 1; m.taughtStudents += e.students }
        else { m.ledEvents += 1; m.ledDivers += e.students }
        m.students += e.students
        m.collected += e.share
        months.set(e.month, m)
      }
      const key = `${e.kind}:${e.category ?? ''}`
      const c = categories.get(key) ?? {
        kind: e.kind, category: e.category ?? '', events: 0, students: 0, collected: 0,
      }
      c.events += 1
      c.students += e.students
      c.collected += e.share
      categories.set(key, c)
    }

    const sum = (list: EventRevenue[]) => ({
      events: list.length,
      students: list.reduce((s, e) => s + e.students, 0),
      collected: list.reduce((s, e) => s + e.share, 0),
    })

    return {
      personId,
      name: displayName(personById.get(personId) ?? { id: personId, name: null, nickname: null, compensated: true }),
      months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
      categories: [...categories.values()].sort(
        (a, b) => a.kind.localeCompare(b.kind) || a.category.localeCompare(b.category),
      ),
      events: sorted,
      completed: sum(done),
      upcoming: sum(sorted.filter(e => !e.completed)),
    }
  }).sort((a, b) => b.completed.collected - a.completed.collected || a.name.localeCompare(b.name))

  const unattributedDone = unattributedEvents.filter(e => e.completed)
  return {
    season,
    people,
    unattributed: {
      collected: unattributedDone.reduce((s, e) => s + e.collected, 0),
      events: unattributedDone.sort((a, b) => (a.firstDay ?? '').localeCompare(b.firstDay ?? '')),
    },
  }
}
