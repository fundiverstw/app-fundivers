import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatEventSpan } from '../../lib/events'
import { GEAR_ITEMS } from '../../lib/gear'
import type { AppEvent, Booking, BookingDetails, Database, EOAddon, EORoom, Profile } from '../../types/database'

type ProfileUpdate = Database['public']['Tables']['profiles']['Update']

// RegisterForm = modal wrapper around RegisterFormBody.
// RegisterFormBody = the actual 4-step form, reusable from a standalone page
// or the admin edit modal.

interface Props {
  event: AppEvent
  profile: Profile | null
  userId: string
  onClose: () => void
  onBooked: (booking: unknown) => void
  /** If provided, the form opens in edit mode: pre-populated from this row
   *  and submit UPDATEs instead of INSERTing. Used by the admin edit modal. */
  existingBooking?: Booking
}

export function RegisterForm({ event, profile, userId, onClose, onBooked, existingBooking }: Props) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-50" onClick={onClose}>
      <div
        className="bg-slate-800 rounded-t-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <RegisterFormBody
          event={event}
          profile={profile}
          userId={userId}
          onSubmitSuccess={onBooked}
          onCancel={onClose}
          existingBooking={existingBooking}
        />
      </div>
    </div>
  )
}

const GEAR_ALACARTE_PRICES: Record<string, number> = {
  BCD: 450, Regulator: 500, Wetsuit: 200, Fins: 100, Mask: 100, Boots: 100,
}
const GEAR_FULLSET_DAILY = 1500
const NITROX_COURSE_FEE = 6000
const TRANSPORT_FEE = 1300

// supabase-js wraps every non-2xx as `FunctionsHttpError` whose .message
// is just "Edge Function returned a non-2xx status code"; the actual
// server message is buried in .context (a Response). Pull it out, then
// soften the most common case (email already taken) with a recovery
// hint pointing at the inline sign-in banner.
async function readFunctionsError(error: { message: string; context?: unknown }, isGuest: boolean): Promise<string> {
  let msg = error.message
  const ctx = error.context
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const body = await (ctx as Response).json() as { error?: string }
      if (body?.error) msg = body.error
    } catch { /* fall back to wrapper text */ }
  }
  if (isGuest && /already.*registered|already.*exists/i.test(msg)) {
    return 'An account with that email already exists. Use "Sign in" at the top of the page to continue with this email.'
  }
  return msg
}

type Step = 1 | 2 | 3 | 4
type ContactMethod = 'whatsapp' | 'line' | 'phone' | 'email'

export interface RegisterFormBodyProps {
  event: AppEvent
  profile: Profile | null
  /** Authed user id. When omitted, the form runs in guest mode: step 2
   *  collects email/password/ToS and the final submit creates the
   *  account, profile, and booking atomically via the
   *  create-registration edge function. */
  userId?: string
  onSubmitSuccess: (booking: unknown) => void
  /** Optional cancel handler — renders a close button in the header when provided. */
  onCancel?: () => void
  /**
   * Optional handler for the `‹ Back` button when the user is on step 1.
   * Without this, step-1 Back is disabled (the modal flow has nowhere to go
   * back to). The standalone /register page wires this to navigate back to
   * the event picker so users can change their mind mid-form.
   */
  onBackBeforeStepOne?: () => void
  /** Edit mode: pre-populate from this row and UPDATE on submit. */
  existingBooking?: Booking
}

export function RegisterFormBody({ event, profile, userId, onSubmitSuccess, onCancel, onBackBeforeStepOne, existingBooking }: RegisterFormBodyProps) {
  const isGuest = !userId
  const isEdit = !!existingBooking
  const initialDetails = existingBooking?.details as BookingDetails | undefined
  // Gating derived from the event
  const diveDays = Math.max(1, event.dive_days ?? 1)
  // Courses with dive days bundle gear in — we record the fact in the
  // booking but don't prompt. Dives expose the rent toggle when the
  // admin filled in gear_rental_info on EO_dives.
  const gearIncluded = event.type === 'course' && (event.dive_days ?? 0) > 0
  const showGearRentChoice = event.type === 'dive' && !!event.gear_rental_info
  const showRooms = event.has_rooms && event.room_type_ids.length > 0
  const showAddons = event.has_addons && event.addon_ids.length > 0
  const showNitroxAddon = event.nitrox_required && !(profile?.nitrox_certified ?? false)

  const [step, setStep] = useState<Step>(1)
  const [rooms, setRooms] = useState<EORoom[]>([])
  const [addons, setAddons] = useState<EOAddon[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // Form state — pre-populated from existingBooking when editing. The `gearEdited`
  // flag is set true in edit mode so we don't stomp the saved a-la-carte list
  // with the profile's gear_owned fallback.
  const [rentGear, setRentGear] = useState(initialDetails?.gear?.rent ?? false)
  const [gearMode, setGearMode] = useState<'full' | 'a-la-carte'>(
    // Legacy bookings may carry mode: 'provided' from the old dropdown;
    // treat that as "no rental" rather than crashing the dropdown.
    initialDetails?.gear?.rent && initialDetails.gear.mode === 'a-la-carte' ? 'a-la-carte' : 'full'
  )
  const [gearItems, setGearItems] = useState<string[]>(
    (initialDetails?.gear?.rent && initialDetails.gear.items) ? initialDetails.gear.items : []
  )
  const [gearEdited, setGearEdited] = useState(isEdit)
  const [roomId, setRoomId] = useState<string>(initialDetails?.room?.option_id ?? '')
  const [roomNotes, setRoomNotes] = useState(initialDetails?.room?.notes ?? '')
  const [addonIds, setAddonIds] = useState<Set<string>>(new Set(initialDetails?.add_ons ?? []))
  const [needsTransport, setNeedsTransport] = useState(initialDetails?.transportation ?? false)
  const [addNitroxCourse, setAddNitroxCourse] = useState(initialDetails?.nitrox_course_addon ?? false)
  const [payment, setPayment] = useState<'bank_transfer' | 'credit_card' | 'cash'>(
    initialDetails?.payment_method ?? 'bank_transfer'
  )
  const [notes, setNotes] = useState(existingBooking?.notes ?? '')

  // Profile fields — pre-filled from the diver's profile (empty strings for
  // missing values so the inputs are controlled). On submit we UPSERT any
  // changes back to profiles so a Wix visitor who fills these in the first
  // time has them pre-filled for every future registration.
  const [fullName, setFullName]  = useState(profile?.full_name  ?? '')
  const [dob, setDob]            = useState(profile?.date_of_birth ?? '')
  const [nationality, setNationality] = useState(profile?.nationality ?? '')
  const [idNumber, setIdNumber]  = useState(profile?.id_number  ?? '')
  const [phone, setPhone]        = useState(profile?.phone      ?? '')
  const [contactMethod, setContactMethod] = useState<ContactMethod | ''>(profile?.contact_method ?? '')
  const [contactId, setContactId] = useState(profile?.contact_id ?? '')
  const [certAgency, setCertAgency] = useState(profile?.cert_agency ?? '')
  const [certLevel, setCertLevel] = useState(profile?.cert_level ?? '')
  const [loggedDives, setLoggedDives] = useState(profile?.logged_dives ?? 0)
  const [nitroxCertified, setNitroxCertified] = useState(profile?.nitrox_certified ?? false)
  const [emergencyName, setEmergencyName]   = useState(profile?.emergency_contact_name  ?? '')
  const [emergencyPhone, setEmergencyPhone] = useState(profile?.emergency_contact_phone ?? '')

  // Guest-mode credentials — only collected when the visitor isn't signed in.
  // At submit, we signUp with these before inserting the booking.
  const [guestEmail, setGuestEmail] = useState('')
  const [guestPassword, setGuestPassword] = useState('')
  const [guestAgreedTerms, setGuestAgreedTerms] = useState(false)

  useEffect(() => {
    if (gearMode === 'a-la-carte' && !gearEdited) {
      const owned = new Set(profile?.gear_owned ?? [])
      setGearItems((GEAR_ITEMS as readonly string[]).filter(item => !owned.has(item)))
    }
  }, [gearMode, gearEdited, profile])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (showRooms && event.room_type_ids.length > 0) {
        const { data } = await supabase
          .from('EO_rooms' as never)
          .select('_id, title, display_name, added_price, currency')
          .in('_id', event.room_type_ids)
        if (!cancelled) setRooms((data ?? []) as EORoom[])
      }
      if (showAddons && event.addon_ids.length > 0) {
        const { data } = await supabase
          .from('Other_Addons' as never)
          .select('_id, title, display_name, price, currency')
          .in('_id', event.addon_ids)
        if (!cancelled) setAddons((data ?? []) as EOAddon[])
      }
    })()
    return () => { cancelled = true }
  }, [event.id, showRooms, showAddons, event.room_type_ids, event.addon_ids])

  const gearCost = useMemo(() => {
    if (!showGearRentChoice || !rentGear) return 0
    if (gearMode === 'full') return GEAR_FULLSET_DAILY * diveDays
    return gearItems.reduce((s, item) => s + (GEAR_ALACARTE_PRICES[item] ?? 0) * diveDays, 0)
  }, [showGearRentChoice, rentGear, gearMode, gearItems, diveDays])

  const roomCost = useMemo(() => rooms.find(r => r._id === roomId)?.added_price ?? 0, [rooms, roomId])
  const addonsCost = useMemo(() => {
    let total = 0
    for (const a of addons) if (addonIds.has(a._id)) total += a.price ?? 0
    return total
  }, [addons, addonIds])
  const paymentSurcharge = payment === 'credit_card' ? 0.05 : 0
  const base = event.price ?? 0
  const subTotal = base + gearCost + roomCost + addonsCost + (needsTransport ? TRANSPORT_FEE : 0) + ((showNitroxAddon && addNitroxCourse) ? NITROX_COURSE_FEE : 0)
  const total = Math.round(subTotal * (1 + paymentSurcharge))

  function toggleItem(item: string) {
    setGearEdited(true)
    setGearItems(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item])
  }
  function toggleAddon(id: string) {
    setAddonIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function submit() {
    setSaving(true); setErr('')

    const nullish = (v: string) => v.trim() === '' ? null : v.trim()
    const profilePatch: ProfileUpdate = {
      full_name:               nullish(fullName),
      date_of_birth:           nullish(dob),
      nationality:             nullish(nationality),
      id_number:               nullish(idNumber),
      phone:                   nullish(phone),
      contact_method:          (contactMethod || null) as ContactMethod | null,
      contact_id:              nullish(contactId),
      cert_agency:             nullish(certAgency),
      cert_level:              nullish(certLevel),
      logged_dives:            Number.isFinite(loggedDives) ? loggedDives : 0,
      nitrox_certified:        nitroxCertified,
      emergency_contact_name:  nullish(emergencyName),
      emergency_contact_phone: nullish(emergencyPhone),
    }

    const details: BookingDetails = {
      gear: gearIncluded
        ? { rent: false, included: true }
        : (showGearRentChoice && rentGear
          ? {
              rent: true,
              mode: gearMode,
              items: gearMode === 'a-la-carte' ? gearItems : undefined,
              size_overrides: {
                height_cm: profile?.height_cm ?? null,
                weight_kg: profile?.weight_kg ?? null,
                shoe_size: profile?.shoe_size ?? null,
              },
            }
          : { rent: false }),
      room: (showRooms && roomId) ? { option_id: roomId, notes: roomNotes || null } : undefined,
      add_ons: showAddons ? [...addonIds] : [],
      transportation: needsTransport,
      payment_method: payment,
      nitrox_course_addon: showNitroxAddon && addNitroxCourse,
      total,
      deposit: event.deposit_amount ?? undefined,
    }

    if (existingBooking) {
      // Admin edit path stays direct — admin already has the row, no
      // account creation, no email. Don't touch user_id / FK / status.
      const { data, error } = await supabase
        .from('bookings')
        .update({ notes: notes || null, details })
        .eq('id', existingBooking.id)
        .select().single()
      setSaving(false)
      if (error) { setErr(error.message); return }
      if (data) onSubmitSuccess(data)
      return
    }

    // New booking — both guest and authed routes go through the
    // create-registration edge function so account/profile/booking/email
    // happen atomically server-side. The function handles the guest case
    // (creates the account with email_confirm: true) when email/password
    // are provided; authed callers' Bearer JWT identifies the user.
    const { data, error } = await supabase.functions.invoke<{ booking_id: string; session: { access_token: string; refresh_token: string } | null }>(
      'create-registration',
      {
        body: {
          ...(isGuest ? {
            email:    guestEmail.trim(),
            password: guestPassword,
            agreed_to_terms_at: new Date().toISOString(),
          } : {}),
          event_type:    event.type,
          event_id:      event.id,
          profile_patch: profilePatch,
          details,
          notes:         notes || null,
        },
      },
    )
    setSaving(false)
    if (error) { setErr(await readFunctionsError(error, isGuest)); return }
    if (!data?.booking_id) { setErr('Registration failed — please try again.'); return }

    // Guest path returns the session so we can sign the diver in
    // immediately; authed callers already have a session.
    if (data.session) {
      await supabase.auth.setSession(data.session)
    }
    onSubmitSuccess({ id: data.booking_id })
  }

  return (
    <>
      <header className="flex items-center justify-between">
        <span className="text-xs text-slate-400">Step {step} of 4</span>
        {onCancel && (
          <button onClick={onCancel} className="text-slate-400 text-xl leading-none">×</button>
        )}
      </header>

      {step === 1 && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-100">{event.title}</h2>
          <p className="text-sm text-slate-400">
            {formatEventSpan(event, { style: 'long' })}
          </p>
          {event.price != null && (
            <p className="text-sm text-slate-300">From {event.currency} {event.price.toLocaleString()}</p>
          )}
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4">
          <h2 className="text-lg font-bold text-slate-100">About you</h2>
          <p className="text-xs text-slate-400">
            Pre-filled if you've registered before. Edits are saved to your profile.
          </p>

          {isGuest && (
            <div className="border border-slate-700 rounded-lg p-3 space-y-3 bg-slate-900/40">
              <div>
                <p className="text-sm font-semibold text-slate-100">Account</p>
                <p className="text-xs text-slate-400">
                  We'll create a FunDivers account for you so you can check your booking status and sign up for future events faster.
                </p>
              </div>
              <TextField label="Email *" type="email" value={guestEmail} onChange={setGuestEmail} required />
              <TextField label="Password * (min 8 characters)" type="password" value={guestPassword} onChange={setGuestPassword} required />
              <label className="flex items-start gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={guestAgreedTerms} onChange={e => setGuestAgreedTerms(e.target.checked)} className="accent-sky-500 mt-0.5" />
                <span>
                  I agree to the{' '}
                  <a href="/terms" target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">Terms of Use & Privacy</a>.
                </span>
              </label>
            </div>
          )}

          <div className="space-y-3">
            <TextField label="Full name *"      value={fullName}      onChange={setFullName} required />
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Date of birth" type="date" value={dob} onChange={setDob} />
              <TextField label="Nationality" value={nationality} onChange={setNationality} />
            </div>
            <TextField label="Passport / ID number" value={idNumber} onChange={setIdNumber} />

            <div className="grid grid-cols-2 gap-3">
              <TextField label="Phone" type="tel" value={phone} onChange={setPhone} />
              <label className="block">
                <span className="block text-xs text-slate-400 mb-1">Preferred contact</span>
                <select
                  value={contactMethod}
                  onChange={e => setContactMethod(e.target.value as ContactMethod | '')}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-2 text-sm text-slate-100"
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
              <TextField label={`${contactMethod === 'email' ? 'Email' : 'ID / number'}`} value={contactId} onChange={setContactId} />
            )}

            <div className="border-t border-slate-700 pt-3 space-y-3">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Diving</p>
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Cert agency" placeholder="PADI, SSI…" value={certAgency} onChange={setCertAgency} />
                <TextField label="Cert level" placeholder="OW, AOW…" value={certLevel} onChange={setCertLevel} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Logged dives" type="number" min={0}
                  value={loggedDives === 0 ? '' : String(loggedDives)}
                  onChange={v => setLoggedDives(Number(v) || 0)}
                />
                <label className="flex items-end gap-2 text-sm text-slate-300 pb-2">
                  <input type="checkbox" checked={nitroxCertified} onChange={e => setNitroxCertified(e.target.checked)} className="accent-sky-500" />
                  Nitrox certified
                </label>
              </div>
            </div>

            <div className="border-t border-slate-700 pt-3 space-y-3">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Emergency contact</p>
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Name" value={emergencyName} onChange={setEmergencyName} />
                <TextField label="Phone" type="tel" value={emergencyPhone} onChange={setEmergencyPhone} />
              </div>
            </div>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4">
          <h2 className="text-lg font-bold text-slate-100">Extras</h2>

          {!gearIncluded && !showGearRentChoice && !showRooms && !showAddons && !showNitroxAddon && (
            <p className="text-slate-400 text-sm">No extras for this event.</p>
          )}

          {gearIncluded && (
            <p className="text-sm text-slate-300">
              Gear is included with this course — no need to rent.
            </p>
          )}

          {showGearRentChoice && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={rentGear} onChange={e => setRentGear(e.target.checked)} className="accent-sky-500" />
                Rent gear
              </label>
              {event.gear_rental_info && (
                <p className="text-xs text-slate-500 pl-6">{event.gear_rental_info}</p>
              )}
              {rentGear && (
                <div className="pl-6 space-y-2">
                  <select
                    value={gearMode}
                    onChange={e => setGearMode(e.target.value as typeof gearMode)}
                    className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-sm text-slate-100"
                  >
                    <option value="full">Full set ({GEAR_FULLSET_DAILY.toLocaleString()}/day)</option>
                    <option value="a-la-carte">À-la-carte</option>
                  </select>
                  {gearMode === 'a-la-carte' && (
                    <>
                      <p className="text-xs text-slate-500">Check the items you need us to prepare for you:</p>
                      <div className="grid grid-cols-2 gap-1">
                        {GEAR_ITEMS.map(item => (
                          <label key={item} className="flex items-center gap-1 text-xs text-slate-300">
                            <input type="checkbox" checked={gearItems.includes(item)} onChange={() => toggleItem(item)} className="accent-sky-500" />
                            {item} ({GEAR_ALACARTE_PRICES[item]})
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {showRooms && rooms.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-slate-300 font-semibold">Room</p>
              <p className="text-xs text-slate-500">
                Your base price already includes a place to sleep — upgrading is optional.
              </p>
              <select value={roomId} onChange={e => setRoomId(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-sm text-slate-100">
                <option value="">— keep included room —</option>
                {rooms.map(r => (
                  <option key={r._id} value={r._id}>
                    {r.display_name ?? r.title} {r.added_price != null && `(+${r.added_price.toLocaleString()})`}
                  </option>
                ))}
              </select>
              {roomId && (
                <input value={roomNotes} onChange={e => setRoomNotes(e.target.value)} placeholder="Roommate preferences, etc." className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-sm text-slate-100" />
              )}
            </div>
          )}

          {showAddons && addons.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-slate-300 font-semibold">Add-ons</p>
              <div className="max-h-40 overflow-y-auto grid grid-cols-1 gap-1 pr-1">
                {addons.map(a => (
                  <label key={a._id} className="flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={addonIds.has(a._id)} onChange={() => toggleAddon(a._id)} className="accent-sky-500" />
                    <span className="flex-1">{a.display_name ?? a.title}</span>
                    {a.price != null && <span className="text-slate-400">+{a.price.toLocaleString()}</span>}
                  </label>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={needsTransport} onChange={e => setNeedsTransport(e.target.checked)} className="accent-sky-500" />
            Need transportation (+{TRANSPORT_FEE.toLocaleString()})
          </label>

          {showNitroxAddon && (
            <label className="flex gap-2 text-sm text-slate-300 items-start">
              <input type="checkbox" checked={addNitroxCourse} onChange={e => setAddNitroxCourse(e.target.checked)} className="accent-sky-500 mt-1" />
              <span className="flex-1">
                <span className="block">Add Nitrox course (+{NITROX_COURSE_FEE.toLocaleString()})</span>
                <span className="block text-xs text-slate-500">Get your Nitrox certification during this event.</span>
              </span>
            </label>
          )}

          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)"
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-sm text-slate-100" />
        </section>
      )}

      {step === 4 && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-100">Payment</h2>
          <div className="space-y-2">
            {(['bank_transfer', 'credit_card', 'cash'] as const).map(method => (
              <label key={method} className="flex gap-2 text-sm text-slate-300 items-start">
                <input type="radio" name="payment" checked={payment === method} onChange={() => setPayment(method)} className="accent-sky-500 mt-1" />
                <span className="flex-1">
                  <span className="block">
                    {method === 'bank_transfer' && 'Bank transfer'}
                    {method === 'credit_card' && 'Credit card / PayPal (+5%)'}
                    {method === 'cash' && 'Cash on the day'}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {method === 'bank_transfer' && 'We\'ll send you the bank account details.'}
                    {method === 'credit_card' && 'A 5% processing fee applies. We\'ll email you a PayPal invoice.'}
                    {method === 'cash' && 'We\'ll contact you to arrange a convenient time.'}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <div className="text-sm text-slate-300 bg-slate-900/50 rounded-lg p-3 space-y-1">
            <Row label="Base"                value={base} currency={event.currency} />
            {gearCost > 0         && <Row label="Gear"           value={gearCost}     currency={event.currency} />}
            {roomCost > 0         && <Row label="Room"           value={roomCost}     currency={event.currency} />}
            {addonsCost > 0       && <Row label="Add-ons"        value={addonsCost}   currency={event.currency} />}
            {needsTransport       && <Row label="Transport"      value={TRANSPORT_FEE} currency={event.currency} />}
            {(showNitroxAddon && addNitroxCourse) && <Row label="Nitrox course" value={NITROX_COURSE_FEE} currency={event.currency} />}
            {paymentSurcharge > 0 && <Row label="Credit surcharge (5%)" value={total - subTotal} currency={event.currency} />}
            <div className="border-t border-slate-700 pt-1 mt-1">
              <Row label="Total" value={total} currency={event.currency} bold />
            </div>
          </div>

          {!isEdit && (
            <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-900/60 rounded p-2">
              Please note: your reservation is not confirmed until the deposit
              {event.deposit_amount != null && ` (${event.currency} ${event.deposit_amount.toLocaleString()})`} has been paid.
            </p>
          )}

          {err && <p className="text-rose-400 text-sm">{err}</p>}
        </section>
      )}

      <footer className="flex items-center justify-between gap-2 pt-2">
        <button
          onClick={() => {
            if (step === 1) onBackBeforeStepOne?.()
            else setStep((step - 1) as Step)
          }}
          disabled={step === 1 && !onBackBeforeStepOne}
          className="text-sm text-slate-400 hover:text-slate-100 disabled:opacity-40"
        >
          ‹ Back
        </button>
        {step < 4 ? (
          <button
            onClick={() => setStep((step + 1) as Step)}
            disabled={step === 2 && (
              fullName.trim() === '' ||
              (isGuest && (guestEmail.trim() === '' || guestPassword.length < 8 || !guestAgreedTerms))
            )}
            className="bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white text-sm font-semibold py-2 px-4 rounded-lg"
          >
            Next ›
          </button>
        ) : (
          <button onClick={submit} disabled={saving}
            className="bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white text-sm font-semibold py-2 px-4 rounded-lg">
            {saving ? '…' : isEdit ? 'Save changes' : 'Confirm booking'}
          </button>
        )}
      </footer>
    </>
  )
}

function Row({ label, value, currency, bold = false }: { label: string; value: number; currency: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold text-slate-100' : ''}`}>
      <span>{label}</span>
      <span>{currency} {value.toLocaleString()}</span>
    </div>
  )
}

// Small labeled input for the About-you step. `label` wraps the input so
// getByLabelText / screen readers find the association without needing id.
function TextField({
  label, value, onChange, type = 'text', required, placeholder, min,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: 'text' | 'email' | 'tel' | 'number' | 'date' | 'password'
  required?: boolean
  placeholder?: string
  min?: number
}) {
  return (
    <label className="block">
      <span className="block text-xs text-slate-400 mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        min={min}
        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
      />
    </label>
  )
}
