import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatEventSpan } from '../../lib/events'
import { paymentInstructionsFor, paymentConfirmationReminder } from '../../lib/payment-instructions'
import type { AppEvent, Booking, BookingDetails, Database, Profile } from '../../types/database'

type ProfileUpdate = Database['public']['Tables']['profiles']['Update']

const GEAR_FULLSET_DAILY = 1500
const NITROX_COURSE_FEE  = 6000

type PaymentMethod = 'bank_transfer' | 'credit_card' | 'paypal' | 'cash'
type ContactMethod = 'whatsapp' | 'line' | 'phone' | 'email'

// Per-event choices in step 3. Rooms and add-ons aren't surfaced in the
// multi-event flow — those require event-specific DB-fetched options and
// add too much UI to step through N times. Divers who need rooms/add-ons
// should single-book those events. We still write the booking with no
// room / empty add-ons so the trip still goes through.
interface EventChoices {
  rentGear:        boolean
  gearMode:        'full' | 'a-la-carte'
  needsTransport:  boolean | null
  addNitroxCourse: boolean
}

interface Props {
  events: AppEvent[]
  profile: Profile | null
  userId: string
  onClose: () => void
  /** Fires once all bookings have completed (success or failure). The
   *  array contains every booking that successfully landed. */
  onAllBooked: (bookings: Booking[]) => void
}

type Step = 1 | 2 | 3 | 4

export function MultiRegisterForm({ events, profile, userId, onClose, onAllBooked }: Props) {
  const [step, setStep] = useState<Step>(1)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  // Per-event indexed list of submission outcomes — populated after the
  // first parallel submit so partial failures stay visible while the user
  // decides what to do.
  const [submitResults, setSubmitResults] = useState<Array<{ eventId: string; ok: boolean; error?: string }> | null>(null)

  // Working cart — divers can drop events from step 1 if they change
  // their mind. Defaults to the cart the parent handed in.
  const [cart, setCart] = useState<AppEvent[]>(events)

  // Linked child accounts the signed-in user manages. Loaded once at mount.
  // Lets a parent register different divers per cart row (e.g. "me for dive A,
  // child for dive B"). All bookings still share one group_id.
  const [children, setChildren] = useState<Profile[]>([])
  // Per-event target diver id — null/missing = self.
  const [forDiverByEvent, setForDiverByEvent] = useState<Record<string, string | null>>({})

  useEffect(() => {
    // Children only fetched for top-level divers — a profile already
    // tagged with parent_account can't itself have children.
    if (profile?.parent_account) return
    let cancelled = false
    supabase
      .from('profiles')
      .select('*')
      .eq('parent_account', userId)
      .order('full_name', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return
        setChildren((data ?? []) as Profile[])
      })
    return () => { cancelled = true }
  }, [userId, profile])

  const childById = useMemo(() => {
    const m = new Map<string, Profile>()
    for (const c of children) m.set(c.id, c)
    return m
  }, [children])

  // Per-event choices live in a map keyed by event id; initialized lazily.
  const [choicesById, setChoicesById] = useState<Record<string, EventChoices>>(() => {
    const init: Record<string, EventChoices> = {}
    for (const e of events) {
      init[e.id] = {
        rentGear:        false,
        gearMode:        'full',
        needsTransport:  null,
        addNitroxCourse: false,
      }
    }
    return init
  })

  // Profile fields — same shape as RegisterFormBody but trimmed to what
  // actually matters for a confirmed-attendance form. Card uploads are
  // skipped in this flow (signed-in only; assume on-file or admin
  // follow-up). The diver can update the full profile from /profile.
  const [fullName, setFullName]               = useState(profile?.full_name ?? '')
  const [phone, setPhone]                     = useState(profile?.phone ?? '')
  const [contactMethod, setContactMethod]     = useState<ContactMethod | ''>(profile?.contact_method ?? '')
  const [contactId, setContactId]             = useState(profile?.contact_id ?? '')
  const [certAgency, setCertAgency]           = useState(profile?.cert_agency ?? '')
  const [certLevel, setCertLevel]             = useState(profile?.cert_level ?? '')
  const [nitroxCertified, setNitroxCertified] = useState(profile?.nitrox_certified ?? false)
  const [deepCertified, setDeepCertified]     = useState(profile?.deep_certified ?? false)
  const [emergencyName, setEmergencyName]     = useState(profile?.emergency_contact_name ?? '')
  const [emergencyPhone, setEmergencyPhone]   = useState(profile?.emergency_contact_phone ?? '')

  const [payment, setPayment] = useState<PaymentMethod>('bank_transfer')
  const [creditCardInvoiceEmail, setCreditCardInvoiceEmail] = useState('')

  // Per-event totals derived from the diver's choices.
  const eventTotals = useMemo(() => {
    const surcharge = payment === 'credit_card' || payment === 'paypal' ? 0.05 : 0
    return cart.map(ev => {
      const c = choicesById[ev.id] ?? { rentGear: false, gearMode: 'full', needsTransport: null, addNitroxCourse: false }
      const base       = ev.price ?? 0
      const days       = Math.max(1, ev.dive_days ?? 1)
      const gearIncluded = ev.type === 'course' && (ev.dive_days ?? 0) > 0
      const gearCost   = (!gearIncluded && c.rentGear && c.gearMode === 'full')
        ? GEAR_FULLSET_DAILY * days
        : 0
      const transportSurcharge = ev.transport_price ?? 0
      const transportCost = transportSurcharge > 0 && c.needsTransport === true ? transportSurcharge : 0
      const targetForDiverId = forDiverByEvent[ev.id] ?? null
      const targetProfile = targetForDiverId
        ? (childById.get(targetForDiverId) ?? profile)
        : profile
      const showNitroxAddon = ev.nitrox_required && !(targetProfile?.nitrox_certified ?? false)
      const nitroxFee = showNitroxAddon && c.addNitroxCourse ? NITROX_COURSE_FEE : 0
      const subTotal = base + gearCost + transportCost + nitroxFee
      return Math.round(subTotal * (1 + surcharge))
    })
  }, [cart, choicesById, payment, profile, forDiverByEvent, childById])

  const grandTotal = eventTotals.reduce((s, n) => s + n, 0)

  function updateChoice(eventId: string, patch: Partial<EventChoices>) {
    setChoicesById(prev => ({ ...prev, [eventId]: { ...prev[eventId], ...patch } }))
  }

  function removeFromCart(eventId: string) {
    setCart(prev => prev.filter(e => e.id !== eventId))
  }

  // Step gates — same spirit as solo flow, only the multi-applicable ones.
  const step2Blocked = fullName.trim() === ''
  const step3Blocked = cart.some(ev => choicesById[ev.id]?.needsTransport === null)
  const submitBlocked = cart.length === 0

  async function submit() {
    setSaving(true)
    setErr('')

    const nullish = (v: string) => v.trim() === '' ? null : v.trim()
    const profilePatch: ProfileUpdate = {
      full_name:               nullish(fullName),
      phone:                   nullish(phone),
      contact_method:          (contactMethod || null) as ContactMethod | null,
      contact_id:              nullish(contactId),
      cert_agency:             nullish(certAgency),
      cert_level:              nullish(certLevel),
      nitrox_certified:        nitroxCertified,
      deep_certified:          deepCertified,
      emergency_contact_name:  nullish(emergencyName),
      emergency_contact_phone: nullish(emergencyPhone),
    }

    // Shared group id — every booking from this submit gets the same one
    // so admins can see the trip as a unit. Generated client-side because
    // the edge function inserts one booking at a time.
    const groupId = crypto.randomUUID()

    // Fire all create-registration calls in parallel. Partial failures
    // are surfaced row-by-row — Promise.allSettled keeps us from short-
    // circuiting on the first error.
    const calls = cart.map(async (ev) => {
      const c = choicesById[ev.id]
      const gearIncluded = ev.type === 'course' && (ev.dive_days ?? 0) > 0
      // When the booking is for a linked child, look up nitrox status on
      // the child's profile (not the parent's) so we don't show / charge
      // for a nitrox course they don't need.
      const targetForDiverId = forDiverByEvent[ev.id] ?? null
      const targetProfile = targetForDiverId
        ? (childById.get(targetForDiverId) ?? profile)
        : profile
      const showNitroxAddon = ev.nitrox_required && !(targetProfile?.nitrox_certified ?? false)

      const details: BookingDetails = {
        gear: gearIncluded
          ? { rent: false, included: true }
          : (c.rentGear ? { rent: true, mode: c.gearMode } : { rent: false }),
        add_ons: [],
        transportation: c.needsTransport === true,
        payment_method: payment,
        credit_card_invoice_email: payment === 'credit_card' && creditCardInvoiceEmail.trim()
          ? creditCardInvoiceEmail.trim()
          : undefined,
        pay_deposit_only: false,
        nitrox_course_addon: showNitroxAddon && c.addNitroxCourse,
        total: eventTotals[cart.indexOf(ev)],
        deposit: ev.deposit_amount ?? undefined,
      }

      // Self-targeted bookings update the parent's profile with whatever
      // they typed in step 2. Child-targeted bookings leave the child's
      // profile untouched (the parent's typed values would otherwise
      // overwrite it).
      const patchForCall = targetForDiverId ? {} : profilePatch
      const { data, error } = await supabase.functions.invoke<{ booking_id: string; status?: string }>(
        'create-registration',
        {
          body: {
            event_type:    ev.type,
            event_id:      ev.id,
            profile_patch: patchForCall,
            details,
            notes:         null,
            group_id:      groupId,
            ...(targetForDiverId ? { target_user_id: targetForDiverId } : {}),
          },
        },
      )
      if (error) throw new Error(error.message)
      if (!data?.booking_id) throw new Error('no booking id returned')
      return {
        id:           data.booking_id,
        status:       (data.status ?? 'pending') as Booking['status'],
        eventId:      ev.id,
        eventType:    ev.type,
        bookingUserId: targetForDiverId ?? userId,
      }
    })

    const settled = await Promise.allSettled(calls)
    setSaving(false)

    const successes: Booking[] = []
    const results: Array<{ eventId: string; ok: boolean; error?: string }> = []
    settled.forEach((res, i) => {
      const ev = cart[i]
      if (res.status === 'fulfilled') {
        results.push({ eventId: ev.id, ok: true })
        // Synthetic Booking row — enough for the parent to flag the
        // event as booked in the calendar list. The full row is fetched
        // next time the page loads.
        successes.push({
          id:           res.value.id,
          created_at:   new Date().toISOString(),
          user_id:      res.value.bookingUserId,
          status:       res.value.status,
          notes:        null,
          eo_dive_id:   ev.type === 'dive'   ? ev.id : null,
          eo_course_id: ev.type === 'course' ? ev.id : null,
          details:      {},
          refund_requested_at: null,
          group_id:     groupId,
        } as Booking)
      } else {
        const msg = res.reason instanceof Error ? res.reason.message : String(res.reason)
        results.push({ eventId: ev.id, ok: false, error: msg })
      }
    })

    setSubmitResults(results)

    if (successes.length === cart.length) {
      onAllBooked(successes)
      return
    }
    if (successes.length === 0) {
      setErr('No events could be booked. See errors below and try again.')
      return
    }
    // Mixed result — fire onAllBooked with the successes so the parent
    // updates its bookings cache, but stay open so the diver sees which
    // events failed.
    onAllBooked(successes)
    setErr(`${successes.length} of ${cart.length} events booked. Failures listed below.`)
  }

  return (
    <div
      className="fixed inset-0 bg-blue-900/60 backdrop-blur-sm flex items-start justify-center z-50 px-4 pt-8 pb-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Multi-event registration"
      onClick={onClose}
    >
      <div
        className="bg-white/80 backdrop-blur-md border border-red-500 rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <header className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-xl font-bold text-blue-900 leading-tight">
              Register for {cart.length} event{cart.length === 1 ? '' : 's'}
            </h1>
            <button onClick={onClose} className="text-blue-900 font-medium text-xl leading-none shrink-0">×</button>
          </div>
          <p className="text-xs text-blue-900 font-medium">Step {step} of 4</p>
        </header>

        {step === 1 && (
          <section className="space-y-3">
            <p className="text-sm text-blue-950 font-medium">
              Review the events you're registering for. Tap × on any row to drop it.
            </p>
            <ul className="space-y-2">
              {cart.map(ev => (
                <li key={ev.id} className="bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-blue-900 truncate">{ev.title}</p>
                      <p className="text-xs text-blue-900 font-medium">
                        {formatEventSpan(ev, { style: 'long' })}
                      </p>
                      {ev.price != null && (
                        <p className="text-xs text-blue-950 font-medium">
                          From {ev.currency} {ev.price.toLocaleString()}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFromCart(ev.id)}
                      aria-label={`Remove ${ev.title}`}
                      className="text-blue-900 font-medium text-lg leading-none px-2"
                    >×</button>
                  </div>
                  {children.length > 0 && (
                    <label className="block">
                      <span className="block text-xs text-blue-900 font-medium mb-1">For diver</span>
                      <select
                        value={forDiverByEvent[ev.id] ?? ''}
                        onChange={e => setForDiverByEvent(prev => ({
                          ...prev,
                          [ev.id]: e.target.value || null,
                        }))}
                        aria-label={`Diver for ${ev.title}`}
                        className="w-full bg-white border border-sky-300 rounded-lg px-2 py-1.5 text-sm text-blue-900"
                      >
                        <option value="">Myself ({profile?.display_name ?? profile?.full_name ?? 'me'})</option>
                        {children.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.full_name ?? '(no name)'}{c.display_name ? ` “${c.display_name}”` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </li>
              ))}
              {cart.length === 0 && (
                <li className="text-sm text-blue-950 font-medium italic">
                  No events left. Close this and pick at least one to continue.
                </li>
              )}
            </ul>
            <p className="text-xs text-blue-950 font-medium">
              Rooms and add-ons aren't selectable in the multi-event flow yet.
              For events that need them, register individually.
            </p>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-blue-900">About you</h2>
            <p className="text-xs text-blue-900 font-medium">
              Pre-filled from your profile. Edits save back when you submit.
            </p>
            <div className="space-y-3">
              <TextField label="Full name *" value={fullName} onChange={setFullName} required />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextField label="Phone" type="tel" value={phone} onChange={setPhone} />
                <label className="block">
                  <span className="block text-xs text-blue-900 font-medium mb-1">Preferred contact</span>
                  <select
                    value={contactMethod}
                    onChange={e => setContactMethod(e.target.value as ContactMethod | '')}
                    className="w-full bg-white border border-sky-300 rounded-lg px-2 py-2 text-sm text-blue-900"
                  >
                    <option value="">—</option>
                    <option value="line">LINE</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="phone">Phone</option>
                    <option value="email">Email</option>
                  </select>
                </label>
              </div>
              {contactMethod && (
                <TextField label={contactMethod === 'email' ? 'Email' : 'ID / number'} value={contactId} onChange={setContactId} />
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextField label="Cert agency" placeholder="PADI, SSI…" value={certAgency} onChange={setCertAgency} />
                <TextField label="Cert level" placeholder="OW, AOW…" value={certLevel} onChange={setCertLevel} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm text-blue-950 font-medium">
                  <input type="checkbox" checked={nitroxCertified} onChange={e => setNitroxCertified(e.target.checked)} className="accent-blue-900" />
                  Nitrox certified
                </label>
                <label className="flex items-center gap-2 text-sm text-blue-950 font-medium">
                  <input type="checkbox" checked={deepCertified} onChange={e => setDeepCertified(e.target.checked)} className="accent-blue-900" />
                  Deep certified (40m)
                </label>
              </div>
              <div className="border-t border-sky-200 pt-3 space-y-3">
                <p className="text-xs text-blue-900 font-medium uppercase tracking-wider">Emergency contact</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TextField label="Name" value={emergencyName} onChange={setEmergencyName} />
                  <TextField label="Phone" type="tel" value={emergencyPhone} onChange={setEmergencyPhone} />
                </div>
              </div>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-blue-900">Extras per event</h2>
            <p className="text-xs text-blue-900 font-medium">
              Pick gear / transport / nitrox course for each event below. Transport choice is required.
            </p>
            <div className="space-y-3">
              {cart.map(ev => {
                const c = choicesById[ev.id]
                const gearIncluded = ev.type === 'course' && (ev.dive_days ?? 0) > 0
                const showGearRentChoice = ev.type === 'dive' && !!ev.gear_rental_info
                const transportSurcharge = ev.transport_price ?? 0
                const transportIncluded = transportSurcharge <= 0
                const targetForDiverId = forDiverByEvent[ev.id] ?? null
                const targetProfile = targetForDiverId
                  ? (childById.get(targetForDiverId) ?? profile)
                  : profile
                const showNitroxAddon = ev.nitrox_required && !(targetProfile?.nitrox_certified ?? false)
                const targetLabel = targetForDiverId
                  ? (targetProfile?.display_name ?? targetProfile?.full_name ?? '(child)')
                  : null
                return (
                  <div key={ev.id} className="bg-sky-50 border border-sky-200 rounded-lg p-3 space-y-2">
                    <p className="text-sm font-semibold text-blue-900">
                      {ev.title}
                      {targetLabel && (
                        <span className="ml-2 text-xs text-blue-700">· for {targetLabel}</span>
                      )}
                    </p>
                    {gearIncluded && (
                      <p className="text-xs text-blue-950 font-medium">Gear is included with this course.</p>
                    )}
                    {showGearRentChoice && (
                      <label className="flex items-center gap-2 text-sm text-blue-950 font-medium">
                        <input type="checkbox" checked={c.rentGear} onChange={e => updateChoice(ev.id, { rentGear: e.target.checked })} className="accent-blue-900" />
                        Rent full gear set (+{GEAR_FULLSET_DAILY.toLocaleString()}/day)
                      </label>
                    )}
                    <fieldset className="space-y-1">
                      <legend className="text-xs font-semibold text-blue-900">Transportation *</legend>
                      <label className="flex items-start gap-2 text-sm text-blue-950 font-medium">
                        <input type="radio" name={`t-${ev.id}`} checked={c.needsTransport === true} onChange={() => updateChoice(ev.id, { needsTransport: true })} className="accent-blue-900 mt-1" />
                        <span className="flex-1">
                          Yes, ride with the shop
                          {!transportIncluded && transportSurcharge > 0 && (
                            <span className="block text-xs text-blue-950 font-medium">+{transportSurcharge.toLocaleString()} {ev.currency}</span>
                          )}
                          {transportIncluded && (
                            <span className="block text-xs text-blue-950 font-medium">Included in base price</span>
                          )}
                        </span>
                      </label>
                      <label className="flex items-start gap-2 text-sm text-blue-950 font-medium">
                        <input type="radio" name={`t-${ev.id}`} checked={c.needsTransport === false} onChange={() => updateChoice(ev.id, { needsTransport: false })} className="accent-blue-900 mt-1" />
                        <span className="flex-1">No, I'll get there myself</span>
                      </label>
                    </fieldset>
                    {showNitroxAddon && (
                      <label className="flex items-start gap-2 text-sm text-blue-950 font-medium">
                        <input type="checkbox" checked={c.addNitroxCourse} onChange={e => updateChoice(ev.id, { addNitroxCourse: e.target.checked })} className="accent-blue-900 mt-1" />
                        <span className="flex-1">Add Nitrox course (+{NITROX_COURSE_FEE.toLocaleString()})</span>
                      </label>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-blue-900">Payment</h2>
            <div className="space-y-2">
              {(['bank_transfer', 'paypal', 'credit_card', 'cash'] as const).map(method => (
                <label key={method} className="flex gap-2 text-sm text-blue-950 font-medium items-start">
                  <input type="radio" name="payment" checked={payment === method} onChange={() => setPayment(method)} className="accent-blue-900 mt-1" />
                  <span className="flex-1">
                    {method === 'bank_transfer' && 'Bank transfer'}
                    {method === 'paypal' && 'PayPal (+5%)'}
                    {method === 'credit_card' && 'Credit card (+5%)'}
                    {method === 'cash' && 'Cash (in person at the shop)'}
                  </span>
                </label>
              ))}
            </div>

            {payment === 'credit_card' && (
              <label className="block">
                <span className="block text-xs text-blue-900 font-medium mb-1">Invoice email (optional)</span>
                <input
                  type="email"
                  value={creditCardInvoiceEmail}
                  onChange={e => setCreditCardInvoiceEmail(e.target.value)}
                  placeholder="Defaults to your registered email"
                  className="w-full bg-white border border-sky-300 rounded-lg px-3 py-2 text-sm text-blue-900"
                />
              </label>
            )}

            <PaymentInstructionsBlock method={payment} />

            <div className="text-sm text-blue-950 font-medium bg-sky-50 rounded-lg p-3 space-y-1">
              {cart.map((ev, i) => (
                <div key={ev.id} className="flex justify-between">
                  <span className="truncate pr-2">{ev.title}</span>
                  <span className="shrink-0">{ev.currency} {eventTotals[i]?.toLocaleString() ?? '0'}</span>
                </div>
              ))}
              <div className="border-t border-sky-200 pt-1 mt-1 flex justify-between font-bold text-blue-900">
                <span>Grand total</span>
                <span>{cart[0]?.currency ?? 'TWD'} {grandTotal.toLocaleString()}</span>
              </div>
            </div>

            <p className="text-xs text-red-700 bg-red-50 border border-red-500 rounded p-2">
              Reservations are confirmed once deposit (or full payment) is received.
            </p>

            {submitResults && submitResults.some(r => !r.ok) && (
              <div className="text-xs bg-amber-50 border border-amber-400 rounded p-2 space-y-1">
                <p className="font-semibold text-amber-900">Some events could not be booked:</p>
                {submitResults.filter(r => !r.ok).map(r => {
                  const ev = cart.find(e => e.id === r.eventId)
                  return (
                    <p key={r.eventId} className="text-amber-900">
                      • {ev?.title ?? r.eventId}: {r.error}
                    </p>
                  )
                })}
              </div>
            )}

            {err && <p className="text-red-600 text-sm">{err}</p>}
          </section>
        )}

        <footer className="flex items-center justify-between gap-2 pt-2">
          <button
            onClick={() => setStep((step - 1) as Step)}
            disabled={step === 1}
            className="text-sm text-blue-900 font-medium hover:text-blue-900 disabled:opacity-40"
          >
            ‹ Back
          </button>
          {step < 4 ? (
            <button
              onClick={() => setStep((step + 1) as Step)}
              disabled={
                (step === 1 && cart.length === 0) ||
                (step === 2 && step2Blocked) ||
                (step === 3 && step3Blocked)
              }
              className="bg-blue-900 hover:bg-blue-950 disabled:opacity-40 text-white text-sm font-semibold py-2 px-4 rounded-lg"
            >
              Next ›
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={saving || submitBlocked}
              className="bg-blue-900 hover:bg-blue-950 disabled:opacity-60 disabled:cursor-wait text-white text-sm font-semibold py-2 px-4 rounded-lg inline-flex items-center gap-2"
            >
              {saving && (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
              )}
              {saving ? 'Submitting…' : `Confirm ${cart.length} booking${cart.length === 1 ? '' : 's'}`}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

function PaymentInstructionsBlock({ method }: { method: PaymentMethod }) {
  const instr = paymentInstructionsFor(method)
  const reminder = paymentConfirmationReminder()
  return (
    <>
      <div className="text-xs text-blue-950 font-medium bg-white/70 border border-sky-200 rounded-lg p-3 space-y-1">
        <p className="font-semibold text-blue-900">{instr.title}</p>
        {instr.lines.map((line, i) => <p key={i}>{line}</p>)}
      </div>
      <div className="text-xs text-blue-950 font-medium bg-amber-50 border border-amber-300 rounded-lg p-3 space-y-1">
        <p className="font-semibold text-blue-900">{reminder.title}</p>
        {reminder.lines.map((line, i) => <p key={i}>{line}</p>)}
      </div>
    </>
  )
}

function TextField({
  label, value, onChange, type = 'text', required, placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: 'text' | 'email' | 'tel' | 'date' | 'password' | 'number'
  required?: boolean
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="block text-xs text-blue-900 font-medium mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="w-full bg-white border border-sky-300 rounded-lg px-2 py-2 text-sm text-blue-900 focus:outline-none focus:border-blue-900"
      />
    </label>
  )
}
