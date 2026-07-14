import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { startOfMonth, endOfMonth, format, parseISO } from 'date-fns'
import { fetchEventsInRange } from '../../lib/events'
import { rescheduleEventDay, notifyEventRescheduled } from '../../lib/reschedule'
import { fetchMyDutyDays } from '../../lib/duties'
import { fetchStaffAvailabilityInRange } from '../../lib/staff-availability'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { MonthCalendar } from '../../components/calendar/MonthCalendar'
import { BusyEntryModal } from '../../components/admin/BusyEntryModal'
import type { AppEvent, StaffBusyEntry } from '../../types/database'
import { t } from '../../i18n'

const ae = t.admin.events

// Persisted in sessionStorage so clicking an event and returning via the
// detail page's "back to events" link lands the admin on the month they
// were viewing, not today's month.
const MONTH_STORAGE_KEY = 'admin-events:month'

function readStoredMonth(): Date {
  try {
    const stored = sessionStorage.getItem(MONTH_STORAGE_KEY)
    if (stored) {
      const d = new Date(stored)
      if (!Number.isNaN(d.getTime())) return d
    }
  } catch { /* sessionStorage may be unavailable (private mode, SSR) */ }
  return new Date()
}

export function AdminEventsPage() {
  const navigate = useNavigate()
  // A ?diver=<id> deep link (from the Create-diver page) rides along to the
  // chosen event so its detail page can open the add-diver modal preselected.
  const [searchParams] = useSearchParams()
  const diverParam = searchParams.get('diver')
  const { user, profile } = useAuth()
  const toast = useToast()
  const [month, setMonth] = useState<Date>(readStoredMonth)
  // Bumped to re-run the data fetch after a write (e.g. a drag-reschedule).
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    try { sessionStorage.setItem(MONTH_STORAGE_KEY, month.toISOString()) } catch { /* ignore */ }
  }, [month])
  const [events, setEvents] = useState<AppEvent[]>([])
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [busyEntries, setBusyEntries] = useState<StaffBusyEntry[]>([])
  const [myDutyDays, setMyDutyDays] = useState<Map<string, Set<string>>>(new Map())
  const [createBusyDate, setCreateBusyDate] = useState<string | null>(null)
  const [editBusy, setEditBusy] = useState<StaffBusyEntry | null>(null)
  // null = no manual toggle yet, fall back to the role default. Once the
  // user clicks the pill, this becomes a concrete boolean and wins. The
  // null sentinel matters because `profile` from useAuth resolves async,
  // so a plain useState(initialDefault) would freeze at the pre-profile
  // value (false) on first render.
  const [busyShownOverride, setBusyShownOverride] = useState<boolean | null>(null)

  useEffect(() => {
    // Widen ±7 days so bars touching the month from either side render
    // continuously — same pattern as the diver calendar.
    const from = new Date(startOfMonth(month).getTime() - 7 * 86_400_000).toISOString().slice(0, 10)
    const to = new Date(endOfMonth(month).getTime() + 7 * 86_400_000).toISOString().slice(0, 10)

    let cancelled = false
    ;(async () => {
      const [evs, busy, dutyDays] = await Promise.all([
        // Admin calendar shows private dives (hidden from diver-facing views).
        fetchEventsInRange(from, to, { includePrivate: true }),
        fetchStaffAvailabilityInRange(from, to),
        user ? fetchMyDutyDays(user.id, from, to) : Promise.resolve(new Map<string, Set<string>>()),
      ])
      if (cancelled) return
      setEvents(evs)
      setBusyEntries(busy)
      setMyDutyDays(dutyDays)

      const eventIds = evs.map(e => e.id)
      if (eventIds.length === 0) { setCounts(new Map()); return }

      const { data } = await supabase
        .from('bookings').select('event_id').in('event_id', eventIds).neq('status', 'cancelled')
      if (cancelled) return

      const next = new Map<string, number>()
      for (const r of (data ?? []) as Array<{ event_id: string | null }>) {
        if (r.event_id) next.set(r.event_id, (next.get(r.event_id) ?? 0) + 1)
      }
      setCounts(next)
    })()

    return () => { cancelled = true }
  }, [month, user, refreshKey])

  // Busy overlay defaults ON for both roles so unavailable periods are
  // visible the moment staff/admin land on the calendar — they can flip
  // it off when they want a clean view of just the events.
  const isStaffOrAdmin = profile?.role === 'staff' || profile?.role === 'admin'
  const isAdmin = profile?.role === 'admin'
  const busyShown = busyShownOverride ?? isStaffOrAdmin

  return (
    <div className="max-w-2xl mx-auto">
      <MonthCalendar
        month={month}
        onMonthChange={setMonth}
        events={events}
        onPickEvent={ev => navigate(`/admin/events/${ev.id}${diverParam ? `?diver=${diverParam}` : ''}`)}
        // Only admins can write EO_* rows (is_admin() RLS). The drag
        // gesture is gated on this prop, so staff/divers never see it.
        onRescheduleDay={isAdmin
          ? async (ev, from, to) => {
              await rescheduleEventDay(ev, from, to)
              // Best-effort: notify registered divers of the date change.
              // A push failure must not block the move from showing success.
              notifyEventRescheduled(ev.id, ev.type, from, to).catch(() => { /* best-effort */ })
              toast.success(ae.movedTo(format(parseISO(to), 'EEE, MMM d')))
              setRefreshKey(k => k + 1)
            }
          : undefined}
        hidePastInList
        renderListBadge={ev => {
          const regs = counts.get(ev.id) ?? 0
          if (regs === 0) return null
          return (
            <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-accent">
              {ae.registeredCount(regs)}
            </span>
          )
        }}
        busyEntries={isStaffOrAdmin ? busyEntries : undefined}
        busyShown={busyShown}
        onToggleBusy={isStaffOrAdmin ? () => setBusyShownOverride(!busyShown) : undefined}
        currentUserId={user?.id ?? null}
        ownDutyDays={myDutyDays}
        onCreateBusy={isStaffOrAdmin
          ? day => setCreateBusyDate(format(day, 'yyyy-MM-dd'))
          : undefined}
        onPickBusy={isStaffOrAdmin
          // Only open the edit modal on rows the viewer owns. Non-own rows
          // have their title/details masked (NULL) by the view, so there's
          // nothing personal to show and editing them would fail RLS anyway.
          ? b => { if (user && b.user_id === user.id) setEditBusy(b) }
          : undefined}
      />

      {createBusyDate && user && (
        <BusyEntryModal
          mode="create"
          userId={user.id}
          defaultDate={createBusyDate}
          onClose={() => setCreateBusyDate(null)}
          onSaved={row => {
            setBusyEntries(prev => [...prev, row])
            setCreateBusyDate(null)
          }}
        />
      )}

      {editBusy && (
        <BusyEntryModal
          mode="edit"
          entry={editBusy}
          canDelete={!!user && editBusy.user_id === user.id}
          onClose={() => setEditBusy(null)}
          onSaved={row => {
            setBusyEntries(prev => prev.map(b => b.id === row.id ? row : b))
            setEditBusy(null)
          }}
          onDeleted={id => {
            setBusyEntries(prev => prev.filter(b => b.id !== id))
            setEditBusy(null)
          }}
        />
      )}
    </div>
  )
}
