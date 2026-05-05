import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchEventsForBookings, formatEventSpan } from '../lib/events'
import type { AppEvent, Booking, Payment } from '../types/database'
import {
  CARD, BTN_GHOST, BTN_DANGER, TEXT_HEADING, TEXT_BODY, TEXT_MUTED, TEXT_SUBTLE, TEXT_ERROR, PAGE_BODY,
} from '../styles/tokens'

type Row = Booking & {
  event: AppEvent | null
  payments: Payment[]
  paidSum: number
}

type AddonNameMap = Map<string, string>

const STATUS_STYLES: Record<Booking['status'], string> = {
  pending: 'text-red-600',
  confirmed: 'text-blue-900 font-semibold',
  cancelled: 'text-blue-900/40 line-through',
  waitlisted: 'text-sky-600',
}

export function BookingsPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [addonNames, setAddonNames] = useState<AddonNameMap>(new Map())

  async function refetch(uid: string) {
    const [bookingsRes, paymentsRes] = await Promise.all([
      supabase.from('bookings').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
      supabase.from('payments').select('*').eq('user_id', uid),
    ])
    const bookings = bookingsRes.data ?? []
    const payments = (paymentsRes.data ?? []) as Payment[]

    const diveIds = bookings.map(b => b.eo_dive_id).filter((x): x is string => !!x)
    const courseIds = bookings.map(b => b.eo_course_id).filter((x): x is string => !!x)
    const eventMap = (diveIds.length || courseIds.length)
      ? await fetchEventsForBookings(diveIds, courseIds)
      : new Map<string, AppEvent>()

    const paymentsByBooking = new Map<string, Payment[]>()
    for (const p of payments) {
      if (!p.booking_id) continue
      const arr = paymentsByBooking.get(p.booking_id) ?? []
      arr.push(p)
      paymentsByBooking.set(p.booking_id, arr)
    }

    setRows(bookings.map(b => {
      const bookingPayments = paymentsByBooking.get(b.id) ?? []
      const paidSum = bookingPayments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
      return {
        ...b,
        event: eventMap.get((b.eo_dive_id ?? b.eo_course_id)!) ?? null,
        payments: bookingPayments,
        paidSum,
      }
    }))

    // Resolve add-on IDs → display names so the breakdown doesn't show UUIDs.
    const addonIds = new Set<string>()
    for (const b of bookings) {
      const d = b.details as Booking['details']
      for (const id of d?.add_ons ?? []) addonIds.add(id)
    }
    if (addonIds.size) {
      const { data } = await supabase
        .from('Other_Addons')
        .select('_id, display_title, admin_title')
        .in('_id', [...addonIds])
      setAddonNames(new Map((data ?? []).map(a => [a._id, a.display_title || a.admin_title || a._id])))
    } else {
      setAddonNames(new Map())
    }

    setLoading(false)
  }

  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      if (!cancelled) await refetch(user.id)
    })()
    return () => { cancelled = true }
  }, [user])

  async function cancelBooking(id: string) {
    await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', id)
    if (user) await refetch(user.id)
  }

  async function requestRefund(id: string) {
    await supabase.from('bookings').update({ refund_requested_at: new Date().toISOString() }).eq('id', id)
    if (user) await refetch(user.id)
  }

  const upcoming = rows.filter(r =>
    r.status !== 'cancelled' && r.event && new Date(r.event.start_time) >= new Date()
  )
  const past = rows.filter(r =>
    r.status === 'cancelled' || !r.event || new Date(r.event.start_time) < new Date()
  )

  if (loading) {
    return <div className="flex justify-center pt-12"><div className="w-6 h-6 border-2 border-blue-900 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-bold text-white">My Bookings</h1>

      <section>
        <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider mb-2">Upcoming</h2>
        {upcoming.length === 0
          ? <p className={`${PAGE_BODY} text-sm`}>No upcoming bookings. Check the calendar!</p>
          : <div className="space-y-2">
              {upcoming.map(r => (
                <Card
                  key={r.id}
                  row={r}
                  addonNames={addonNames}
                  open={expanded === r.id}
                  onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                  onCancel={cancelBooking}
                  onRefund={requestRefund}
                />
              ))}
            </div>
        }
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider mb-2">Past / Cancelled</h2>
          <div className="space-y-2">
            {past.map(r => (
              <Card
                key={r.id}
                row={r}
                addonNames={addonNames}
                open={expanded === r.id}
                onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                onCancel={cancelBooking}
                onRefund={requestRefund}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Card({
  row, addonNames, open, onToggle, onCancel, onRefund,
}: {
  row: Row
  addonNames: AddonNameMap
  open: boolean
  onToggle: () => void
  onCancel: (id: string) => void
  onRefund: (id: string) => void
}) {
  const details = (row.details ?? {}) as Booking['details']
  const total = Number((details as { total?: number } | undefined)?.total ?? 0)
  const deposit = Number((details as { deposit?: number } | undefined)?.deposit ?? 0)
  const canCancel = row.status === 'pending' && row.paidSum === 0 && !row.refund_requested_at
  const canRefund = row.paidSum > 0 && row.status !== 'cancelled' && !row.refund_requested_at

  return (
    <div className={CARD}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-4 flex items-start justify-between hover:bg-sky-50 rounded-xl transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className={`font-medium ${TEXT_HEADING} text-sm`}>
            {row.event?.title ?? '(event unavailable)'}
          </p>
          {row.event && (
            <p className={`text-xs ${TEXT_MUTED} mt-0.5`}>
              {formatEventSpan(row.event, { withYear: true })}
              {' · '}
              {row.event.type === 'dive' ? 'Dive' : 'Course'}
            </p>
          )}
          {row.refund_requested_at && (
            <p className={`text-xs ${TEXT_ERROR} mt-0.5`}>🔄 Refund requested {format(new Date(row.refund_requested_at), 'MMM d')}</p>
          )}
        </div>
        <div className="text-right shrink-0 ml-3">
          <span className={`text-xs font-medium capitalize ${STATUS_STYLES[row.status]}`}>{row.status}</span>
          <p className={`text-xs ${TEXT_SUBTLE} mt-0.5`}>{open ? '▲' : '▼'}</p>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-sky-200 pt-3 space-y-3 text-sm">
          {total > 0 && (
            <div className={`flex justify-between ${TEXT_BODY}`}>
              <span>Total</span>
              <span className="font-semibold">{row.event?.currency ?? 'TWD'} {total.toLocaleString()}</span>
            </div>
          )}
          {deposit > 0 && (
            <div className={`flex justify-between ${TEXT_BODY}`}>
              <span>Deposit</span>
              <span className={row.paidSum >= deposit ? 'text-blue-900 font-semibold' : TEXT_ERROR}>
                {row.event?.currency ?? 'TWD'} {deposit.toLocaleString()} {row.paidSum >= deposit ? '✓' : 'due'}
              </span>
            </div>
          )}
          {row.paidSum > 0 && (
            <div className={`flex justify-between ${TEXT_BODY}`}>
              <span>Paid so far</span>
              <span className="text-blue-900 font-semibold">{row.event?.currency ?? 'TWD'} {row.paidSum.toLocaleString()}</span>
            </div>
          )}

          <Breakdown details={details} addonNames={addonNames} />

          {row.notes && (
            <p className={`text-xs ${TEXT_MUTED} bg-sky-50 rounded p-2`}>📝 {row.notes}</p>
          )}
          <p className={`text-xs ${TEXT_SUBTLE}`}>
            Booked {format(new Date(row.created_at), 'MMM d, yyyy')}
          </p>

          <div className="flex gap-2 pt-1">
            {canCancel && (
              <button onClick={() => onCancel(row.id)} className={`flex-1 ${BTN_DANGER} text-xs py-2 px-3`}>
                Cancel booking
              </button>
            )}
            {canRefund && (
              <button onClick={() => onRefund(row.id)} className={`flex-1 ${BTN_GHOST} text-xs py-2 px-3`}>
                Request refund
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Breakdown({ details, addonNames }: { details: Booking['details'] | undefined; addonNames: AddonNameMap }) {
  const d = details ?? {}
  const items: Array<[string, string | null]> = []
  if (d.gear?.rent) {
    const extras = d.gear.items?.length ? d.gear.items.join(', ') : null
    items.push([`Gear (${d.gear.mode ?? 'full'})`, extras])
  }
  if (d.room?.option_id) items.push(['Room', d.room.notes ?? null])
  if ((d.add_ons?.length ?? 0) > 0) {
    const labels = d.add_ons!.map(id => addonNames.get(id) ?? id)
    items.push(['Add-ons', labels.join(', ')])
  }
  if (d.transportation) items.push(['Transportation', null])
  if (d.nitrox_course_addon) items.push(['Nitrox course add-on', null])
  if (d.payment_method) items.push(['Payment', d.payment_method.replace('_', ' ')])

  if (items.length === 0) return null
  return (
    <div className={`text-xs ${TEXT_MUTED} space-y-0.5`}>
      {items.map(([label, extra]) => (
        <p key={label}>{label}{extra && <span className={TEXT_SUBTLE}> — {extra}</span>}</p>
      ))}
    </div>
  )
}
