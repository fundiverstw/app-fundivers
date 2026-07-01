import { useEffect, useState } from 'react'
import { personName } from '../../lib/names'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../hooks/useToast'
import { fetchEventsForBookings, formatEventSpan } from '../../lib/events'
import {
  CARD_ELEVATED, BTN_PRIMARY, BTN_DANGER, TEXT_MUTED, INPUT,
} from '../../styles/tokens'
import type { AppEvent, Booking, Profile } from '../../types/database'

// Admin queue for the manual-verification gate. Lists every profile in
// status='pending' (newest first), with their first booking expanded
// inline so the admin has the application context they need to decide.
//
// Approve  → calls notify-application-decision edge function:
//             flips status to 'active' + emails the diver.
// Reject   → same function with decision='reject':
//             flips status to 'rejected' + emails with optional reason.

interface PendingExtras {
  booking: (Booking & { event: AppEvent | null }) | null
}

export function AdminApplicationsPage() {
  const toast = useToast()
  const [users, setUsers] = useState<Profile[]>([])
  const [extrasCache, setExtras] = useState<Map<string, PendingExtras>>(new Map())
  const [expandedId, setExpanded] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)
  const [rejectReasons, setRejectReasons] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Filter to applications the diver has actually submitted — the
      // BEFORE UPDATE trigger on profiles stamps `application_submitted_at`
      // the first time all required fields are populated. Without this
      // filter, admins see a row the instant a diver hits "Sign up",
      // before they've typed a single field.
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('status', 'pending')
        .not('application_submitted_at', 'is', null)
        .order('application_submitted_at', { ascending: false })
      if (!cancelled) setUsers((data ?? []) as Profile[])
    })()
    return () => { cancelled = true }
  }, [])

  async function expand(userId: string) {
    if (expandedId === userId) { setExpanded(null); return }
    setExpanded(userId)
    if (extrasCache.has(userId)) return

    const { data: bookings } = await supabase
      .from('bookings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
    const first = (bookings ?? [])[0] ?? null

    let hydrated: PendingExtras['booking'] = null
    if (first) {
      const eventMap = await fetchEventsForBookings(
        first.eo_dive_id ? [first.eo_dive_id] : [],
        first.eo_course_id ? [first.eo_course_id] : [],
      )
      const event = eventMap.get((first.eo_dive_id ?? first.eo_course_id)!) ?? null
      hydrated = { ...first, event }
    }

    setExtras(prev => {
      const next = new Map(prev)
      next.set(userId, { booking: hydrated })
      return next
    })
  }

  async function decide(userId: string, decision: 'approve' | 'reject') {
    const reason = decision === 'reject' ? (rejectReasons.get(userId) ?? '').trim() : undefined
    setActing(userId)
    try {
      const { data, error } = await supabase.functions.invoke<{
        ok: boolean
        status: 'active' | 'rejected'
        email_sent: boolean
      }>('notify-application-decision', {
        body: { user_id: userId, decision, ...(reason ? { reason } : {}) },
      })
      if (error) throw new Error(error.message)
      if (!data?.ok) throw new Error('decision failed')

      const verb = decision === 'approve' ? 'Approved' : 'Rejected'
      const tail = data.email_sent ? ' · email sent' : ' · email skipped'
      toast.success(`${verb}${tail}`)
      setUsers(prev => prev.filter(u => u.id !== userId))
      setExpanded(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Decision failed')
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold text-white">Applications</h1>
        <span className={`text-sm ${TEXT_MUTED}`}>
          {users.length} pending
        </span>
      </header>

      {users.length === 0 && (
        <div className={`${CARD_ELEVATED} p-6 text-center`}>
          <p className={TEXT_MUTED}>No pending applications.</p>
        </div>
      )}

      <ul className="space-y-3">
        {users.map(u => {
          const extras = extrasCache.get(u.id)
          const isExpanded = expandedId === u.id
          const isActing = acting === u.id
          return (
            <li key={u.id} className={CARD_ELEVATED}>
              <button
                type="button"
                onClick={() => expand(u.id)}
                className="w-full p-4 flex items-baseline justify-between gap-3 text-left"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-brand-950 truncate">
                    {personName(u.name, u.nickname) || '(no name yet)'}
                  </div>
                  <div className={`text-xs ${TEXT_MUTED}`}>
                    submitted {format(new Date(u.created_at), 'PP')}
                  </div>
                </div>
                <span className={`text-xs ${TEXT_MUTED}`}>{isExpanded ? '−' : '+'}</span>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 space-y-4 text-sm">
                  <ApplicantSummary profile={u} />
                  <FirstBooking booking={extras?.booking ?? null} />

                  <div className="space-y-2 pt-2 border-t border-surface-200">
                    <textarea
                      className={`${INPUT} text-sm`}
                      rows={2}
                      placeholder="Optional rejection reason (included in the email)"
                      value={rejectReasons.get(u.id) ?? ''}
                      onChange={e => {
                        const v = e.target.value
                        setRejectReasons(prev => {
                          const next = new Map(prev)
                          next.set(u.id, v)
                          return next
                        })
                      }}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => decide(u.id, 'approve')}
                        disabled={isActing}
                        className={`flex-1 ${BTN_PRIMARY}`}
                      >
                        {isActing ? '…' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        onClick={() => decide(u.id, 'reject')}
                        disabled={isActing}
                        className={`flex-1 ${BTN_DANGER}`}
                      >
                        {isActing ? '…' : 'Reject'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ApplicantSummary({ profile }: { profile: Profile }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
      <Row k="Email" v={profile.contact_id ?? '—'} />
      <Row k="Cert"  v={profile.cert_level ? `${profile.cert_agency ?? ''} ${profile.cert_level}`.trim() : '—'} />
      <Row k="Logged dives" v={String(profile.logged_dives ?? 0)} />
      <Row k="Nationality" v={profile.nationality ?? '—'} />
      <Row k="DOB" v={profile.date_of_birth ?? '—'} />
      <Row k="Emergency" v={profile.emergency_contact_name ? `${profile.emergency_contact_name} · ${profile.emergency_contact_phone ?? ''}`.trim() : '—'} />
      <Row k="Medical" v={profile.medical_notes || '—'} />
    </dl>
  )
}

function FirstBooking({ booking }: { booking: (Booking & { event: AppEvent | null }) | null }) {
  if (!booking) {
    return <p className={`${TEXT_MUTED} italic`}>No booking submitted with this application.</p>
  }
  return (
    <div className="border-t border-surface-200 pt-3 space-y-1">
      <div className="font-semibold text-brand-950">First booking</div>
      <div>{booking.event?.title ?? '(unknown event)'}</div>
      {booking.event && (
        <div className={`text-xs ${TEXT_MUTED}`}>
          {formatEventSpan(booking.event)}
        </div>
      )}
      {booking.notes && <div className="text-xs">Notes: {booking.notes}</div>}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className={`${TEXT_MUTED} text-xs`}>{k}</dt>
      <dd className="text-brand-950 text-xs">{v}</dd>
    </>
  )
}
