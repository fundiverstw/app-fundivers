import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageLoading } from '../../components/ui/Spinner'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { siteConfig } from '../../config/site'
import { fetchEventsInRange, fetchUpcomingEventDays, formatEventSpan } from '../../lib/events'
import { gearTotals, splitByTransport, dayKeyOffset, careTotals, isCareGearItem, addonTotals } from '../../lib/logistics'
import { bookingBalance, type BookingBalance } from '../../lib/booking-balance'
import { openCreditForBooking } from '../../lib/credits'
import { personName } from '../../lib/names'
import { DiverGearCard, type DiverGearRow } from '../../components/admin/DiverGearCard'
import { TransportGroup } from '../../components/admin/TransportGroup'
import { StaffDutyGroup, type StaffDutyRow } from '../../components/admin/StaffDutyGroup'
import { CareGearGroup } from '../../components/admin/CareGearGroup'
import { AddonSummaryGroup } from '../../components/admin/AddonSummaryGroup'
import { PaymentsDueGroup } from '../../components/admin/PaymentsDueGroup'
import { TransportFleetPlan } from '../../components/admin/TransportFleetPlan'
import { EventVehicleGroup } from '../../components/admin/EventVehicleGroup'
import { fetchVehicles } from '../../lib/vehicles'
import { fetchGearModelsWithSizes } from '../../lib/gear-models'
import type { GearModelWithSizes } from '../../lib/gear-sizing'
import { fetchVehiclesForEvents, availableVehicles, allocationEventId } from '../../lib/event-vehicles'
import { planFleet, type Rider, type SeatingPlan, type FleetVehicle } from '../../lib/vehicle-planning'
import { useAuth } from '../../hooks/useAuth'
import type { AppEvent, Booking, BookingDetails, Credit, Duty, EventVehicle, Payment, Profile, Vehicle } from '../../types/database'
import { t } from '../../i18n'

const lg = t.admin.logistics
const gr = t.admin.groups
const tp = t.admin.transport

// Per-booking outstanding balance + the lead responsible for it (if covered).
interface BookingBalanceRow { bal: BookingBalance; payerName: string | null }

interface EventGroup {
  event: AppEvent
  rows: DiverGearRow[]
  staff: StaffDutyRow[]
}

// How far ahead the "Other day" picker looks for days that have events.
const LOOKAHEAD_DAYS = 30

type Tab = 'today' | 'tomorrow' | 'other'

export function AdminLogisticsPage() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [tab, setTab] = useState<Tab>('today')
  const [otherDay, setOtherDay] = useState('')
  // The shop's gear sizing charts, loaded once for the rental fit lookup.
  const [gearModels, setGearModels] = useState<GearModelWithSizes[]>([])
  useEffect(() => {
    fetchGearModelsWithSizes().then(setGearModels).catch(() => { /* charts are optional */ })
  }, [])
  // null = not loaded yet; [] = loaded, no event-days in range.
  const [upcomingDays, setUpcomingDays] = useState<string[] | null>(null)
  // null = loading; [] = loaded, no events that day.
  const [groups, setGroups] = useState<EventGroup[] | null>(null)
  // add-on _id → catalog title, for classifying "handle with care" rentals
  // (dive lights, cameras) that have no category column.
  const [addonTitles, setAddonTitles] = useState<Map<string, string>>(new Map())
  // booking id → outstanding balance, for the day's "who still owes" view.
  const [balances, setBalances] = useState<Map<string, BookingBalanceRow>>(new Map())
  // The whole transport fleet — loaded once. Active vehicles plan rides; the
  // full list (incl. retired) names cars in existing allocations.
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  // Car-to-event allocations for the day's events (one row per car per event).
  const [allocations, setAllocations] = useState<EventVehicle[]>([])
  // Bumped after an assign/unassign to refetch the allocations.
  const [allocReload, setAllocReload] = useState(0)

  const todayKey = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: siteConfig.locale.timezone }),
    [],
  )
  const tomorrowKey = useMemo(() => dayKeyOffset(todayKey, 1), [todayKey])

  const dayKey =
    tab === 'today' ? todayKey
      : tab === 'tomorrow' ? tomorrowKey
        : otherDay

  // Load the transport fleet once — it's the same across every day.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const v = await fetchVehicles()
        if (!cancelled) setVehicles(v)
      } catch { /* fleet just won't be planned; logistics still works */ }
    })()
    return () => { cancelled = true }
  }, [])

  // Car allocations for the day's events — refetched when the events change or
  // after an assign/unassign (allocReload). Allocations are keyed by event now,
  // so we ask for exactly the events shown.
  useEffect(() => {
    if (!groups || groups.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAllocations([])
      return
    }
    const eventIds = groups.map(g => g.event.id)
    let cancelled = false
    ;(async () => {
      try {
        const rows = await fetchVehiclesForEvents(eventIds)
        if (!cancelled) setAllocations(rows)
      } catch { if (!cancelled) setAllocations([]) }
    })()
    return () => { cancelled = true }
  }, [groups, allocReload])

  // Populate the "Other day" dropdown with upcoming days that actually have
  // events, so the admin never picks a dead day.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const days = await fetchUpcomingEventDays(todayKey, dayKeyOffset(todayKey, LOOKAHEAD_DAYS))
      if (!cancelled) setUpcomingDays(days)
    })()
    return () => { cancelled = true }
  }, [todayKey])

  // Entering "Other day" with nothing chosen yet → default to the first
  // upcoming day beyond tomorrow (those two have their own tabs).
  useEffect(() => {
    if (tab !== 'other' || otherDay || !upcomingDays?.length) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOtherDay(upcomingDays.find(d => d > tomorrowKey) ?? upcomingDays[0])
  }, [tab, otherDay, upcomingDays, tomorrowKey])

  useEffect(() => {
    if (!dayKey) return
    let cancelled = false
    // Reset to the loading spinner whenever the selected day changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGroups(null)
    ;(async () => {
      // fetchEventsInRange(day, day) returns dives starting that day and
      // courses running that day. A rare multi-day dive that started earlier
      // won't appear — acceptable for a day-of view.
      const events = await fetchEventsInRange(dayKey, dayKey, { includePrivate: true })
      if (cancelled) return
      // Dedupe by id (a course could yield more than one segment); first wins.
      const seen = new Set<string>()
      const uniqueEvents = events.filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)))
      if (!uniqueEvents.length) { setGroups([]); return }

      const eventIds = uniqueEvents.map(e => e.id)
      // Duties whose date range covers this day, for the day's events. Staff
      // have no transport preference, so each on-duty assignment is surfaced
      // in the ride planning below. A null end_date is a single-day duty.
      const dayCovered = `end_date.gte.${dayKey},end_date.is.null`
      const [bookingsB, dutiesB] = await Promise.all([
        eventIds.length
          ? supabase.from('bookings').select('*').in('event_id', eventIds).neq('status', 'cancelled')
          : Promise.resolve({ data: [] as Booking[] }),
        eventIds.length
          ? supabase.from('duties').select('*').in('event_id', eventIds).lte('start_date', dayKey).or(dayCovered)
          : Promise.resolve({ data: [] as Duty[] }),
      ])
      const bookings = (bookingsB.data ?? []) as Booking[]
      const duties = (dutiesB.data ?? []) as Duty[]

      // Resolve catalog titles for the day's add-ons so we can pick out the
      // delicate ones (lights, cameras) for the care inventory.
      const addonIds = [...new Set(
        bookings.flatMap(b => (b.details as BookingDetails | undefined)?.add_ons ?? []),
      )]
      const addonsRes = addonIds.length
        ? await supabase.from('addons').select('id, display_title, admin_title').in('id', addonIds)
        : { data: [] as Array<{ id: string; display_title: string | null; admin_title: string | null }> }
      if (cancelled) return
      setAddonTitles(new Map(
        (addonsRes.data ?? []).map(a => [a.id, a.display_title || a.admin_title || a.id]),
      ))

      const userIds = [...new Set([
        ...bookings.map(b => b.user_id),
        // Lead payers may not themselves be booked that day, but we still need
        // their name for "paid by …" on a covered diver's balance.
        ...bookings.map(b => b.payer_id).filter((x): x is string => !!x),
        ...duties.map(d => d.assignee_id),
      ])]
      const bookingIds = bookings.map(b => b.id)
      const [profsRes, paymentsRes, creditsRes] = await Promise.all([
        userIds.length
          ? supabase.from('profiles').select('*').in('id', userIds)
          : Promise.resolve({ data: [] as Profile[] }),
        bookingIds.length
          ? supabase.from('payments').select('*').in('booking_id', bookingIds)
          : Promise.resolve({ data: [] as Payment[] }),
        userIds.length
          ? supabase.from('credits').select('*').in('user_id', userIds).eq('status', 'open')
          : Promise.resolve({ data: [] as Credit[] }),
      ])
      if (cancelled) return
      const profMap = new Map((profsRes.data ?? []).map(p => [p.id, p]))

      // Per-booking "what's still owed" — total minus paid payments and any
      // open credit, mirroring the event page's Amount-owed math so the two
      // never disagree. A covered booking keeps its own balance but notes the
      // lead who's responsible for it.
      const paidByBooking = new Map<string, number>()
      for (const p of (paymentsRes.data ?? []) as Payment[]) {
        if (!p.booking_id || p.status !== 'paid') continue
        paidByBooking.set(p.booking_id, (paidByBooking.get(p.booking_id) ?? 0) + p.amount)
      }
      const credits = (creditsRes.data ?? []) as Credit[]
      const balByBooking = new Map<string, BookingBalanceRow>()
      for (const b of bookings) {
        const owed = Number((b.details as BookingDetails | undefined)?.total ?? 0)
        const paid = paidByBooking.get(b.id) ?? 0
        const payerName = (b.payer_id && b.payer_id !== b.user_id)
          ? (personName(profMap.get(b.payer_id)?.name, profMap.get(b.payer_id)?.nickname) || lg.leadBooker)
          : null
        balByBooking.set(b.id, { bal: bookingBalance(owed, paid, openCreditForBooking(credits, b.id)), payerName })
      }
      if (cancelled) return
      setBalances(balByBooking)

      const byEvent = new Map<string, DiverGearRow[]>()
      for (const b of bookings) {
        const eid = b.event_id
        if (!eid) continue
        const arr = byEvent.get(eid) ?? []
        arr.push({ booking: b, profile: profMap.get(b.user_id) ?? null })
        byEvent.set(eid, arr)
      }

      const staffByEvent = new Map<string, StaffDutyRow[]>()
      for (const d of duties) {
        const eid = d.event_id
        if (!eid) continue
        const arr = staffByEvent.get(eid) ?? []
        arr.push({ dutyId: d.id, role: d.role, profile: profMap.get(d.assignee_id) ?? null })
        staffByEvent.set(eid, arr)
      }

      if (cancelled) return
      setGroups(uniqueEvents.map(ev => ({
        event: ev,
        rows: byEvent.get(ev.id) ?? [],
        staff: staffByEvent.get(ev.id) ?? [],
      })))
    })()
    return () => { cancelled = true }
  }, [dayKey])

  // Keep a diver's displayed sizes in sync after an inline save, across every
  // event group they appear in that day.
  function patchProfile(diverId: string, patch: Partial<Profile>) {
    setGroups(prev => prev?.map(g => ({
      ...g,
      rows: g.rows.map(r =>
        r.profile && r.profile.id === diverId
          ? { ...r, profile: { ...r.profile, ...patch } as Profile }
          : r),
    })) ?? prev)
  }

  const allRows = (groups ?? []).flatMap(g => g.rows)
  // Care items (dive computers, lights, cameras) are issued and tracked
  // separately, so drop them from the dive-bag "Gear to pack" chips.
  const overallGear = gearTotals(allRows).filter(g => !isCareGearItem(g.item))
  const overallCare = careTotals(allRows, addonTitles)
  // Whole-day add-on tally (SMBs, nitrox tanks, course upgrades, lights, …) so
  // the shop's prep list sits next to gear + handle-with-care in the summary.
  const overallAddons = addonTotals(allRows, addonTitles)
  const transport = splitByTransport(allRows)
  // Each on-duty staff member once, regardless of how many of the day's events
  // they cover, so the board's staff count isn't double-counted.
  const staffRiders: Rider[] = []
  // Day-wide on-duty staff for the overall board — one entry per person even
  // when they cover several of the day's events, with all the roles they hold.
  const dayStaff: { key: string; name: string; roles: string[] }[] = []
  const staffIndex = new Map<string, number>()
  for (const s of (groups ?? []).flatMap(g => g.staff)) {
    const key = s.profile?.id ?? s.dutyId
    let i = staffIndex.get(key)
    if (i === undefined) {
      i = dayStaff.length
      staffIndex.set(key, i)
      const name = personName(s.profile?.name, s.profile?.nickname) || lg.staffFallback
      dayStaff.push({ key, name, roles: [] })
      staffRiders.push({ id: key, name, kind: 'staff' })
    }
    if (!dayStaff[i].roles.includes(s.role)) dayStaff[i].roles.push(s.role)
  }
  const onDutyStaffCount = staffRiders.length
  // Divers who still owe — for the whole-day summary and each event's list.
  const currency = (groups ?? [])[0]?.event.currency ?? siteConfig.locale.currency
  const dueRowsFor = (rows: DiverGearRow[]) => rows.flatMap(r => {
    const e = balances.get(r.booking.id)
    if (!e || e.bal.state !== 'due') return []
    return [{
      bookingId: r.booking.id,
      name: personName(r.profile?.name, r.profile?.nickname) || tp.noProfile,
      amount: e.bal.amount,
      payerName: e.payerName,
    }]
  })
  const dayDue = dueRowsFor(allRows)
  const dayOutstanding = dayDue.reduce((s, x) => s + x.amount, 0)
  // Active fleet plans rides and fills the assign pickers; retired cars stay in
  // `vehicles` only to name existing allocations.
  const activeVehicles = vehicles.filter(v => v.active)
  const vehicleMap = new Map(vehicles.map(v => [v.id, v]))
  // Allocations grouped by the event they're on, for the per-event car block.
  const allocByEvent = new Map<string, EventVehicle[]>()
  for (const a of allocations) {
    const eid = allocationEventId(a)
    if (!eid) continue
    const arr = allocByEvent.get(eid) ?? []
    arr.push(a)
    allocByEvent.set(eid, arr)
  }
  // Ride plan follows the per-event car assignments: each event's ride-needing
  // divers and on-duty staff are seated ONLY in the cars assigned to that event
  // (a diver can't ride in a car that isn't on their event). Staff covering
  // several of the day's events are seated once — in the first event they turn
  // up in — so the day total counts each body once. The overall plan is the sum
  // of these per-event seatings, so assigning/unassigning a car reshuffles the
  // divers and refreshes this section.
  const seatedStaff = new Set<string>()
  const fleetPlan = combinePlans((groups ?? []).map(g => {
    const eventDivers: Rider[] = splitByTransport(g.rows).needsRide.map(r => ({
      id: r.profile?.id ?? r.booking.id,
      name: personName(r.profile?.name, r.profile?.nickname) || tp.noProfile,
      kind: 'diver',
    }))
    const eventStaff: Rider[] = []
    for (const s of g.staff) {
      const key = s.profile?.id ?? s.dutyId
      if (seatedStaff.has(key)) continue
      seatedStaff.add(key)
      eventStaff.push({
        id: key,
        name: personName(s.profile?.name, s.profile?.nickname) || lg.staffFallback,
        kind: 'staff',
      })
    }
    const fleet: FleetVehicle[] = (allocByEvent.get(g.event.id) ?? [])
      .map(a => vehicleMap.get(a.vehicle_id))
      .filter((v): v is Vehicle => !!v)
      .map(v => ({ name: v.name, passenger_seats: v.passenger_seats }))
    return planFleet(fleet, eventDivers, eventStaff)
  }))

  const promptForDay = tab === 'other' && !otherDay

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <header className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-bold text-brand-900">{t.nav.logistics}</h1>
          {dayKey && <span className="text-xs text-brand-900 font-medium">{dayKey}</span>}
        </div>
        <div role="tablist" aria-label={lg.dayTablistAria} className="flex flex-wrap gap-2 items-center">
          <DayTab label={lg.today}    active={tab === 'today'}    onClick={() => setTab('today')} />
          <DayTab label={lg.tomorrow} active={tab === 'tomorrow'} onClick={() => setTab('tomorrow')} />
          <DayTab label={lg.otherDay} active={tab === 'other'}    onClick={() => setTab('other')} />
          {tab === 'other' && (
            upcomingDays && upcomingDays.length === 0 ? (
              <span className="text-xs text-brand-950 font-medium italic">{lg.noEventsInDays(LOOKAHEAD_DAYS)}</span>
            ) : (
              <select
                aria-label={lg.selectADayAria}
                value={otherDay}
                onChange={e => setOtherDay(e.target.value)}
                className="px-3 py-1 rounded-full text-sm bg-surface-100 text-brand-900 border border-surface-200"
              >
                <option value="">{lg.selectADay}</option>
                {(upcomingDays ?? []).map(d => (
                  <option key={d} value={d}>{format(parseISO(d), 'EEE, MMM d')}</option>
                ))}
              </select>
            )
          )}
        </div>
      </header>

      {promptForDay ? (
        <p className="text-brand-950 font-medium text-sm">{lg.pickADay}</p>
      ) : groups === null ? (
        <PageLoading />
      ) : groups.length === 0 ? (
        <p className="text-brand-950 font-medium text-sm">{lg.noEventsOn(dayKey)}</p>
      ) : (
        <>
          <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-bold text-brand-900 uppercase tracking-wider">{lg.overall(dayKey)}</h2>
            <p className="text-sm text-brand-900 font-medium">{lg.eventsDivers(groups.length, allRows.length)}</p>
            {dayStaff.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-brand-900 uppercase tracking-wide">{gr.onDutyStaff}</p>
                <div className="flex flex-wrap gap-1.5">
                  {dayStaff.map(s => (
                    <span key={s.key} className="text-xs px-2 py-0.5 rounded-full border border-brand-900 text-brand-900 font-medium">
                      {s.name}
                      {s.roles.length > 0 && <span className="font-normal text-brand-950"> · {s.roles.join(', ')}</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {allRows.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-brand-900 uppercase tracking-wide">{t.payments.title}</p>
                {dayOutstanding > 0 ? (
                  <p className="text-sm font-semibold text-red-600">
                    {lg.stillOwe(dayDue.length, currency, dayOutstanding.toLocaleString())}
                  </p>
                ) : (
                  <p className="text-sm text-brand-900 font-medium">{lg.allSettled}</p>
                )}
              </div>
            )}
            <div className="space-y-1">
              <p className="text-xs font-semibold text-brand-900 uppercase tracking-wide">{t.bookings.breakdown.transportation}</p>
              <p className="text-sm text-brand-900 font-medium">
                <span className="text-red-600 font-semibold">{transport.needsRide.length}</span>{lg.needARide}
                {onDutyStaffCount > 0 && (
                  <> · <span className="text-brand-900 font-semibold">{onDutyStaffCount}</span>{lg.onDutyStaffSuffix}</>
                )}
                {' · '}{lg.selfTransportCount(transport.selfTransport.length)}
                {transport.unspecified.length > 0 && <> · {lg.unspecifiedCount(transport.unspecified.length)}</>}
              </p>
              {transport.needsRide.length > 0 && (
                <TransportFleetPlan plan={fleetPlan} fleetSize={activeVehicles.length} />
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-brand-900 uppercase tracking-wide">{lg.gearToPack}</p>
              {overallGear.length === 0 ? (
                <p className="text-sm text-brand-950/70 font-medium italic">{lg.nothingToPack}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {overallGear.map(({ item, count }) => (
                    <span key={item} className="text-xs px-2 py-0.5 rounded-full border border-brand-900 text-brand-900">
                      {item} ×{count}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {overallCare.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">{gr.handleWithCare}</p>
                <div className="flex flex-wrap gap-1.5">
                  {overallCare.map(({ item, divers }) => (
                    <span key={item} className="text-xs px-2 py-0.5 rounded-full border border-amber-500 bg-amber-50 text-amber-900 font-semibold">
                      {item} ×{divers.length}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {overallAddons.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-brand-900 uppercase tracking-wide">{gr.addons}</p>
                <div className="flex flex-wrap gap-1.5">
                  {overallAddons.map(({ title, count }) => (
                    <span key={title} className="text-xs px-2 py-0.5 rounded-full border border-surface-400 bg-surface-50 text-brand-900 font-medium">
                      {title} ×{count}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>

          {groups.map(g => (
            <section key={g.event.id} className="space-y-2 pt-2">
              {/* Bold banner per event so the sections are obvious when
                  scrolling a tall phone screen. */}
              <div className="bg-brand-900 text-white rounded-xl px-4 py-2.5 space-y-0.5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold break-words">
                    {isAdmin ? (
                      <Link
                        to={`/admin/events/${g.event.type}/${g.event.id}/edit`}
                        className="hover:underline"
                      >
                        {g.event.title}
                      </Link>
                    ) : (
                      g.event.title
                    )}
                  </h2>
                  {isAdmin && (
                    <Link
                      to={`/admin/events/${g.event.type}/${g.event.id}/edit`}
                      className="shrink-0 text-xs bg-white/15 hover:bg-white/25 text-white px-2.5 py-1 rounded-lg font-medium"
                    >
                      {t.admin.catalog.edit}
                    </Link>
                  )}
                </div>
                <span className="block text-xs text-white/80">
                  {formatEventSpan(g.event, { style: 'compact' })} · {lg.diverCount(g.rows.length)}
                </span>
              </div>
              <EventTransport rows={g.rows} />
              <StaffDutyGroup rows={g.staff} />
              <EventVehicleGroup
                event={g.event}
                allocations={allocByEvent.get(g.event.id) ?? []}
                available={availableVehicles(
                  activeVehicles,
                  new Set((allocByEvent.get(g.event.id) ?? []).map(a => a.vehicle_id)),
                )}
                vehicleMap={vehicleMap}
                riders={splitByTransport(g.rows).needsRide.length
                  + new Set(g.staff.map(s => s.profile?.id ?? s.dutyId)).size}
                isAdmin={isAdmin}
                createdBy={profile?.id ?? null}
                onChanged={() => setAllocReload(k => k + 1)}
              />
              <CareGearGroup rows={careTotals(g.rows, addonTitles)} />
              <AddonSummaryGroup rows={addonTotals(g.rows, addonTitles)} />
              <PaymentsDueGroup rows={dueRowsFor(g.rows)} currency={currency} />
              {g.rows.length === 0 ? (
                <p className="text-xs text-brand-950/70 font-medium italic pl-1">{tp.noActiveRegistrants}</p>
              ) : (
                g.rows.map(r => (
                  <DiverGearCard key={r.booking.id} row={r} onProfilePatched={patchProfile} linkToProfile={isAdmin} gearModels={gearModels} />
                ))
              )}
            </section>
          ))}
        </>
      )}
    </div>
  )
}

// Fold the per-event seatings into one day-wide plan for the overall board:
// every car taken across the day with who's aboard, plus anyone left without a
// seat in their own event's cars.
function combinePlans(plans: SeatingPlan[]): SeatingPlan {
  const cars = plans.flatMap(p => p.cars)
  const unseated = plans.flatMap(p => p.unseated)
  const divers = plans.reduce((s, p) => s + p.divers, 0)
  const staff = plans.reduce((s, p) => s + p.staff, 0)
  return {
    cars,
    unseated,
    divers,
    staff,
    riders: divers + staff,
    seats: plans.reduce((s, p) => s + p.seats, 0),
    vehiclesNeeded: cars.length,
    fits: unseated.length === 0,
    shortfall: unseated.length,
  }
}

function DayTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-sm transition-colors ${
        active
          ? 'bg-brand-900 text-white font-semibold'
          : 'bg-surface-100 text-brand-900 hover:bg-surface-200'
      }`}
    >
      {label}
    </button>
  )
}

function EventTransport({ rows }: { rows: DiverGearRow[] }) {
  const { needsRide, unspecified } = splitByTransport(rows)
  // Self-transport divers need no van planning, so only surface the actionable
  // buckets here (the full split lives on the event's Transportation tab).
  if (needsRide.length === 0 && unspecified.length === 0) return null
  return (
    <>
      {needsRide.length > 0 && (
        <TransportGroup title={tp.needsRide} rows={needsRide} emptyHint="" />
      )}
      {unspecified.length > 0 && (
        <TransportGroup
          title={lg.transportNotSpecified}
          rows={unspecified}
          emptyHint=""
          note={tp.unspecifiedNote}
        />
      )}
    </>
  )
}
