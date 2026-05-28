import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { formatEventSpan, eventIsFull } from '../../lib/events'
import { computeEffectiveFullPaymentDeadline } from '../../lib/payment-deadlines'
import { paymentInstructionsFor, paymentConfirmationReminder } from '../../lib/payment-instructions'
import { GEAR_ITEMS } from '../../lib/gear'
import { uploadCertCard } from '../../lib/cert-card'
import { uploadNitroxCard } from '../../lib/nitrox-card'
import { isHeicFile } from '../../lib/image-compress'
import type { AppEvent, Booking, BookingDetails, CancellationPolicy, Database, EOAddon, EORoom, Profile } from '../../types/database'

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
    <div className="fixed inset-0 bg-blue-900/60 backdrop-blur-sm flex items-start justify-center z-50 px-4 pt-8 pb-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-white/80 backdrop-blur-md border border-red-500 rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto"
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
  BCD: 450, Regulator: 500, Wetsuit: 200, Fins: 150, Mask: 100, Boots: 100, 'Dive computer': 300,
}
const GEAR_FULLSET_DAILY = 1500
const NITROX_COURSE_FEE = 6000
// Per-event transport surcharge now lives on the linked EO_prices row
// (see event.transport_price). NULL or 0 = transportation bundled into
// the base price.

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
  /** Admin "register on behalf of" path. When set, the form is
   *  authenticated as the admin (their session calls the edge
   *  function) but the booking lands on this target user_id and the
   *  confirmation email goes to that user's address. Profile / userId
   *  must be the *target* diver — not the admin. */
  actingOnBehalfOf?: string
}

export function RegisterFormBody({ event, profile, userId, onSubmitSuccess, onCancel, onBackBeforeStepOne, existingBooking, actingOnBehalfOf }: RegisterFormBodyProps) {
  const isGuest = !userId && !actingOnBehalfOf
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
  const [cancelPolicy, setCancelPolicy] = useState<CancellationPolicy | null>(null)
  // Pre-checked when editing an existing booking that already carries an
  // ack timestamp — admins shouldn't have to re-tick to save unrelated edits.
  const [policyAcked, setPolicyAcked] = useState<boolean>(!!initialDetails?.cancellation_policy_acked_at)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // Form state — pre-populated from existingBooking when editing.
  const [rentGear, setRentGear] = useState(initialDetails?.gear?.rent ?? false)
  const [gearMode, setGearMode] = useState<'full' | 'a-la-carte'>(
    // Legacy bookings may carry mode: 'provided' from the old dropdown;
    // treat that as "no rental" rather than crashing the dropdown.
    initialDetails?.gear?.rent && initialDetails.gear.mode === 'a-la-carte' ? 'a-la-carte' : 'full'
  )
  // À-la-carte selection: explicitly chosen items (or null = use the
  // "everything the diver doesn't already own" default derived from
  // profile.gear_owned). Splitting this two-step keeps the default
  // computed at render — no setState-in-effect dance.
  const [editedGearItems, setEditedGearItems] = useState<string[] | null>(
    (initialDetails?.gear?.rent && initialDetails.gear.items) ? initialDetails.gear.items : null
  )
  const defaultGearItems = useMemo(() => {
    const owned = new Set(profile?.gear_owned ?? [])
    return (GEAR_ITEMS as readonly string[]).filter(item => !owned.has(item))
  }, [profile])
  const gearItems = editedGearItems ?? defaultGearItems
  const [roomId, setRoomId] = useState<string>(initialDetails?.room?.option_id ?? '')
  const [roomNotes, setRoomNotes] = useState(initialDetails?.room?.notes ?? '')
  const [addonIds, setAddonIds] = useState<Set<string>>(new Set(initialDetails?.add_ons ?? []))
  // null = diver hasn't picked yet. Step-3 Next is gated until they explicitly
  // choose so they consciously acknowledge the self-transport responsibility
  // when they decline a ride. Legacy bookings (created before the choice was
  // required) carried `transportation: false` by default, so editing one
  // pre-selects "No" rather than re-asking.
  const [needsTransport, setNeedsTransport] = useState<boolean | null>(
    initialDetails?.transportation ?? null
  )
  const [addNitroxCourse, setAddNitroxCourse] = useState(initialDetails?.nitrox_course_addon ?? false)
  const [payment, setPayment] = useState<'bank_transfer' | 'credit_card' | 'paypal' | 'cash'>(
    initialDetails?.payment_method ?? 'bank_transfer'
  )
  const [creditCardInvoiceEmail, setCreditCardInvoiceEmail] = useState<string>(
    initialDetails?.credit_card_invoice_email ?? ''
  )
  // Default to full payment per product spec. Only meaningful when the event
  // has a deposit_amount — otherwise the radio is hidden entirely.
  const [payDepositOnly, setPayDepositOnly] = useState<boolean>(initialDetails?.pay_deposit_only ?? false)
  const [notes, setNotes] = useState(existingBooking?.notes ?? '')

  const hasDeposit = (event.deposit_amount ?? 0) > 0
  const fullPaymentDeadline = useMemo(() => computeEffectiveFullPaymentDeadline(event), [event])

  // Profile fields — pre-filled from the diver's profile (empty strings for
  // missing values so the inputs are controlled). On submit we UPSERT any
  // changes back to profiles so a Wix visitor who fills these in the first
  // time has them pre-filled for every future registration.
  const [fullName, setFullName]  = useState(profile?.full_name  ?? '')
  const [nameAlt, setNameAlt]    = useState(profile?.name_alt   ?? '')
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
  // Holds a freshly-picked nitrox card until submit, when it gets uploaded
  // to storage. For authed users the upload happens before the
  // create-registration call so the path lands in the profile patch; for
  // guests it runs after setSession so the bucket RLS check (auth.uid()
  // matches folder prefix) passes.
  const [nitroxFile, setNitroxFile] = useState<File | null>(null)
  const [nitroxFileErr, setNitroxFileErr] = useState<string | null>(null)
  const hasNitroxCardOnFile = !!profile?.nitrox_card_path
  // Hard block: nitrox=true but neither an existing card nor a freshly
  // picked file → can't proceed past step 2.
  const nitroxBlocked = nitroxCertified && !hasNitroxCardOnFile && !nitroxFile
  // Same pattern for the main cert card: cert_level set ⇒ photo required.
  // The card stays optional for divers who haven't picked a level (they
  // can still register, e.g. for an entry-level course).
  const [certFile, setCertFile] = useState<File | null>(null)
  const [certFileErr, setCertFileErr] = useState<string | null>(null)
  const hasCertCardOnFile = !!profile?.cert_card_path
  const certBlocked = certLevel.trim() !== '' && !hasCertCardOnFile && !certFile
  const [emergencyName, setEmergencyName]   = useState(profile?.emergency_contact_name  ?? '')
  const [emergencyPhone, setEmergencyPhone] = useState(profile?.emergency_contact_phone ?? '')

  // Guest-mode credentials — only collected when the visitor isn't signed in.
  // At submit, we signUp with these before inserting the booking.
  const [guestEmail, setGuestEmail] = useState('')
  const [guestPassword, setGuestPassword] = useState('')
  const [guestAgreedTerms, setGuestAgreedTerms] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (showRooms && event.room_type_ids.length > 0) {
        const { data } = await supabase
          .from('EO_rooms' as never)
          .select('_id, admin_title, display_title, added_price, currency')
          .in('_id', event.room_type_ids)
        if (!cancelled) setRooms((data ?? []) as EORoom[])
      }
      if (showAddons && event.addon_ids.length > 0) {
        const { data } = await supabase
          .from('Other_Addons' as never)
          .select('_id, admin_title, display_title, price, currency')
          .in('_id', event.addon_ids)
        if (!cancelled) setAddons((data ?? []) as EOAddon[])
      }
      if (event.cancel_policy) {
        const { data } = await supabase
          .from('cancellation_policies' as never)
          .select('_id, title, cancelation_policy')
          .eq('_id', event.cancel_policy)
          .maybeSingle()
        if (!cancelled) setCancelPolicy((data ?? null) as CancellationPolicy | null)
      }
    })()
    return () => { cancelled = true }
  }, [event.id, showRooms, showAddons, event.room_type_ids, event.addon_ids, event.cancel_policy])

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
  // Both PayPal and credit card incur a 5% surcharge (PayPal absorbs ~3% on
  // paypal.me transfers; the card processor's fee is similar). Cash and
  // local bank transfer pass through at face value.
  const paymentSurcharge = payment === 'credit_card' || payment === 'paypal' ? 0.05 : 0
  const base = event.price ?? 0
  // Transport pricing comes from the linked EO_prices row. NULL or 0 means
  // it's bundled into the base price — the form hides the opt-in checkbox
  // and the cost calc skips the surcharge entirely.
  const transportSurcharge = event.transport_price ?? 0
  const transportIncluded = transportSurcharge <= 0
  const transportCost = !transportIncluded && needsTransport === true ? transportSurcharge : 0
  const subTotal = base + gearCost + roomCost + addonsCost + transportCost + ((showNitroxAddon && addNitroxCourse) ? NITROX_COURSE_FEE : 0)
  const total = Math.round(subTotal * (1 + paymentSurcharge))

  function toggleItem(item: string) {
    // First toggle promotes the rendered default (or existing list) into
    // an explicit edited list; subsequent toggles update it.
    const current = editedGearItems ?? gearItems
    setEditedGearItems(current.includes(item) ? current.filter(i => i !== item) : [...current, item])
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

    // Authed callers can upload to storage immediately — RLS lets them
    // write under their own folder. The new path goes into the profile
    // patch the edge function applies. Guests can't upload yet (no
    // session), so we defer their upload to after setSession (below).
    let nitroxCardPath: string | null | undefined = undefined
    if (nitroxCertified && nitroxFile && userId) {
      try {
        nitroxCardPath = await uploadNitroxCard(userId, nitroxFile)
      } catch (e) {
        setSaving(false)
        setErr(`Could not upload nitrox card: ${e instanceof Error ? e.message : 'unknown error'}`)
        return
      }
    }
    let certCardPath: string | null | undefined = undefined
    if (certFile && userId) {
      try {
        certCardPath = await uploadCertCard(userId, certFile)
      } catch (e) {
        setSaving(false)
        setErr(`Could not upload certification card: ${e instanceof Error ? e.message : 'unknown error'}`)
        return
      }
    }

    const nullish = (v: string) => v.trim() === '' ? null : v.trim()
    const profilePatch: ProfileUpdate = {
      full_name:               nullish(fullName),
      name_alt:                nullish(nameAlt),
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
      ...(nitroxCardPath !== undefined ? { nitrox_card_path: nitroxCardPath } : {}),
      ...(certCardPath !== undefined ? { cert_card_path: certCardPath } : {}),
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
      transportation: needsTransport === true,
      payment_method: payment,
      credit_card_invoice_email: payment === 'credit_card' && creditCardInvoiceEmail.trim()
        ? creditCardInvoiceEmail.trim()
        : undefined,
      pay_deposit_only: hasDeposit ? payDepositOnly : false,
      nitrox_course_addon: showNitroxAddon && addNitroxCourse,
      total,
      deposit: event.deposit_amount ?? undefined,
      // Stamp the ack only when there's a policy and the diver ticked the
      // box — preserving any prior ack on the existing booking otherwise.
      cancellation_policy_acked_at: cancelPolicy && policyAcked
        ? (initialDetails?.cancellation_policy_acked_at ?? new Date().toISOString())
        : initialDetails?.cancellation_policy_acked_at,
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
    // When actingOnBehalfOf is set, the caller (admin) JWT is used to
    // authorise, but the booking lands on target_user_id.
    const { data, error } = await supabase.functions.invoke<{ booking_id: string; status?: string; session: { access_token: string; refresh_token: string } | null }>(
      'create-registration',
      {
        body: {
          ...(isGuest ? {
            email:    guestEmail.trim(),
            password: guestPassword,
            agreed_to_terms_at: new Date().toISOString(),
          } : {}),
          ...(actingOnBehalfOf ? { target_user_id: actingOnBehalfOf } : {}),
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
      // Guests can finally upload now that they have a session. Best-effort:
      // if it fails the booking still succeeded, so we surface a console
      // error rather than rolling back — the Profile page's gate catches
      // it on their next visit. getUser() is only called when there's
      // actually something to upload so test mocks that don't stub it
      // aren't dragged into this branch.
      const needGuestUpload = (nitroxCertified && nitroxFile) || certFile
      if (needGuestUpload) {
        const { data: u } = await supabase.auth.getUser()
        const newUserId = u?.user?.id
        if (newUserId) {
          if (nitroxCertified && nitroxFile) {
            try {
              const newPath = await uploadNitroxCard(newUserId, nitroxFile)
              await supabase.from('profiles').update({ nitrox_card_path: newPath }).eq('id', newUserId)
            } catch (e) {
              console.error('nitrox card upload failed after signup:', e)
            }
          }
          if (certFile) {
            try {
              const newPath = await uploadCertCard(newUserId, certFile)
              await supabase.from('profiles').update({ cert_card_path: newPath }).eq('id', newUserId)
            } catch (e) {
              console.error('cert card upload failed after signup:', e)
            }
          }
        }
      }
    }
    // Pass status through so the parent can render a different success
    // toast when the booking landed as 'waitlisted' rather than 'pending'.
    onSubmitSuccess({ id: data.booking_id, status: data.status ?? 'pending' })
  }

  return (
    <>
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold text-blue-900 leading-tight">{event.title}</h1>
          {onCancel && (
            <button onClick={onCancel} className="text-blue-900 font-medium text-xl leading-none shrink-0">×</button>
          )}
        </div>
        <p className="text-xs text-blue-900 font-medium">{formatEventSpan(event, { style: 'long' })}</p>
        <p className="text-xs text-blue-900 font-medium">Step {step} of 4</p>
      </header>

      {step === 1 && (
        <section className="space-y-3">
          {event.price != null && (
            <p className="text-sm text-blue-950 font-medium">From {event.currency} {event.price.toLocaleString()}</p>
          )}
          {/* Title carries the "(N spot(s) open)" / "(fully booked …)"
              suffix via the display_title trigger. We still show a fuller
              banner when the event is full so the diver understands the
              registration will land on the waitlist, not as confirmed. */}
          {eventIsFull(event) && (
            <div
              role="alert"
              className="bg-red-50 border border-red-500 rounded-lg px-3 py-2 text-xs text-red-700"
            >
              <p className="font-semibold">This event is full — register for the waitlist.</p>
              <p>If a spot opens we'll send a push and email — you'll have 24 hours to claim it.</p>
            </div>
          )}
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4">
          <h2 className="text-lg font-bold text-blue-900">About you</h2>
          <p className="text-xs text-blue-900 font-medium">
            Pre-filled if you've registered before. Edits are saved to your profile.
          </p>

          {isGuest && (
            <div className="border border-sky-200 rounded-lg p-3 space-y-3 bg-sky-50">
              <div>
                <p className="text-sm font-semibold text-blue-900">Account</p>
                <p className="text-xs text-blue-900 font-medium">
                  We'll create a FunDivers account for you so you can check your booking status and sign up for future events faster.
                </p>
              </div>
              <TextField label="Email *" type="email" value={guestEmail} onChange={setGuestEmail} required />
              <TextField label="Password * (min 8 characters)" type="password" value={guestPassword} onChange={setGuestPassword} required />
              <label className="flex items-start gap-2 text-xs text-blue-950 font-medium">
                <input type="checkbox" checked={guestAgreedTerms} onChange={e => setGuestAgreedTerms(e.target.checked)} className="accent-blue-900 mt-0.5" />
                <span>
                  I agree to the{' '}
                  <a href="/terms" target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">Terms of Use & Privacy</a>.
                </span>
              </label>
            </div>
          )}

          <div className="space-y-3">
            <TextField label="Full name *"      value={fullName}      onChange={setFullName} required />
            <TextField
              label="Name in another script (optional)"
              value={nameAlt}
              onChange={setNameAlt}
              placeholder="e.g. 陳大文 / 山田太郎 / 김민수"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextField label="Date of birth" type="date" value={dob} onChange={setDob} />
              <TextField label="Nationality" value={nationality} onChange={setNationality} />
            </div>
            <TextField label="Passport / ID number" value={idNumber} onChange={setIdNumber} />

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
              <TextField label={`${contactMethod === 'email' ? 'Email' : 'ID / number'}`} value={contactId} onChange={setContactId} />
            )}

            <div className="border-t border-sky-200 pt-3 space-y-3">
              <p className="text-xs text-blue-900 font-medium uppercase tracking-wider">Diving</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextField label="Cert agency" placeholder="PADI, SSI…" value={certAgency} onChange={setCertAgency} />
                <TextField label="Cert level" placeholder="OW, AOW…" value={certLevel} onChange={setCertLevel} />
              </div>
              {certLevel.trim() !== '' && !hasCertCardOnFile && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-blue-900">
                    Upload a photo of your highest certification card *
                  </p>
                  <p className="text-xs text-blue-950 font-medium">
                    Required because you've filled in a cert level. The photo is
                    stored privately and only visible to FunDivers staff.
                  </p>
                  <label className="block cursor-pointer bg-blue-900 hover:bg-blue-950 text-white text-sm font-semibold py-2 px-3 rounded-lg text-center">
                    <input
                      type="file"
                      accept="image/*,.heic,.heif"
                      aria-label="Upload highest certification card"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0] ?? null
                        e.target.value = ''
                        setCertFileErr(null)
                        if (file && !file.type.startsWith('image/') && !isHeicFile(file)) {
                          setCertFileErr('Please choose an image file.')
                          return
                        }
                        setCertFile(file)
                      }}
                    />
                    {certFile ? `Replace photo (${certFile.name})` : 'Choose photo'}
                  </label>
                  {certFileErr && <p className="text-xs text-red-700">{certFileErr}</p>}
                </div>
              )}
              {certLevel.trim() !== '' && hasCertCardOnFile && (
                <p className="text-xs text-blue-950 font-medium">
                  Certification card on file. (Update it from your profile if
                  it's changed.)
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextField
                  label="Logged dives" type="number" min={0}
                  value={loggedDives === 0 ? '' : String(loggedDives)}
                  onChange={v => setLoggedDives(Number(v) || 0)}
                />
                <label className="flex items-center sm:items-end gap-2 text-sm text-blue-950 font-medium sm:pb-2">
                  <input type="checkbox" checked={nitroxCertified} onChange={e => setNitroxCertified(e.target.checked)} className="accent-blue-900" />
                  Nitrox certified
                </label>
              </div>
              {nitroxCertified && !hasNitroxCardOnFile && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-blue-900">
                    Upload a photo of your nitrox certification card *
                  </p>
                  <p className="text-xs text-blue-950 font-medium">
                    Required because you marked yourself as nitrox certified. The
                    photo is stored privately and only visible to FunDivers staff.
                  </p>
                  <label className="block cursor-pointer bg-blue-900 hover:bg-blue-950 text-white text-sm font-semibold py-2 px-3 rounded-lg text-center">
                    <input
                      type="file"
                      accept="image/*,.heic,.heif"
                      aria-label="Upload nitrox certification card"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0] ?? null
                        e.target.value = ''
                        setNitroxFileErr(null)
                        if (file && !file.type.startsWith('image/') && !isHeicFile(file)) {
                          setNitroxFileErr('Please choose an image file.')
                          return
                        }
                        setNitroxFile(file)
                      }}
                    />
                    {nitroxFile ? `Replace photo (${nitroxFile.name})` : 'Choose photo'}
                  </label>
                  {nitroxFileErr && <p className="text-xs text-red-700">{nitroxFileErr}</p>}
                </div>
              )}
              {nitroxCertified && hasNitroxCardOnFile && (
                <p className="text-xs text-blue-950 font-medium">
                  Nitrox card on file. (Update it from your profile if it's
                  changed.)
                </p>
              )}
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
          <h2 className="text-lg font-bold text-blue-900">Extras</h2>

          {!gearIncluded && !showGearRentChoice && !showRooms && !showAddons && !showNitroxAddon && (
            <p className="text-blue-900 font-medium text-sm">No extras for this event.</p>
          )}

          {gearIncluded && (
            <p className="text-sm text-blue-950 font-medium">
              Gear is included with this course — no need to rent.
            </p>
          )}

          {showGearRentChoice && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-blue-950 font-medium">
                <input type="checkbox" checked={rentGear} onChange={e => setRentGear(e.target.checked)} className="accent-blue-900" />
                Rent gear
              </label>
              {event.gear_rental_info && (
                <p className="text-xs text-blue-950 font-medium pl-6">{event.gear_rental_info}</p>
              )}
              {rentGear && (
                <div className="pl-6 space-y-2">
                  <select
                    value={gearMode}
                    onChange={e => setGearMode(e.target.value as typeof gearMode)}
                    className="bg-white border border-sky-300 rounded-lg px-2 py-1 text-sm text-blue-900"
                  >
                    <option value="full">Full set ({GEAR_FULLSET_DAILY.toLocaleString()}/day)</option>
                    <option value="a-la-carte">À-la-carte</option>
                  </select>
                  {gearMode === 'a-la-carte' && (
                    <>
                      <p className="text-xs text-blue-950 font-medium">Check the items you need us to prepare for you:</p>
                      <div className="grid grid-cols-2 gap-1">
                        {GEAR_ITEMS.map(item => (
                          <label key={item} className="flex items-center gap-1 text-xs text-blue-950 font-medium">
                            <input type="checkbox" checked={gearItems.includes(item)} onChange={() => toggleItem(item)} className="accent-blue-900" />
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
              <p className="text-sm text-blue-950 font-medium font-semibold">Room</p>
              <p className="text-xs text-blue-950 font-medium">
                Your base price already includes a place to sleep — upgrading is optional.
              </p>
              <select value={roomId} onChange={e => setRoomId(e.target.value)} className="w-full bg-white border border-sky-300 rounded-lg px-2 py-1 text-sm text-blue-900">
                <option value="">— keep included room —</option>
                {rooms.map(r => (
                  <option key={r._id} value={r._id}>
                    {r.display_title ?? r.admin_title} {r.added_price != null && `(+${r.added_price.toLocaleString()})`}
                  </option>
                ))}
              </select>
              {roomId && (
                <input value={roomNotes} onChange={e => setRoomNotes(e.target.value)} placeholder="Roommate preferences, etc." className="w-full bg-white border border-sky-300 rounded-lg px-2 py-1 text-sm text-blue-900" />
              )}
            </div>
          )}

          {showAddons && addons.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-blue-950 font-medium font-semibold">Add-ons</p>
              <div className="max-h-40 overflow-y-auto grid grid-cols-1 gap-1 pr-1">
                {addons.map(a => (
                  <label key={a._id} className="flex items-center gap-2 text-xs text-blue-950 font-medium">
                    <input type="checkbox" checked={addonIds.has(a._id)} onChange={() => toggleAddon(a._id)} className="accent-blue-900" />
                    <span className="flex-1">{a.display_title ?? a.admin_title}</span>
                    {a.price != null && <span className="text-blue-900 font-medium">+{a.price.toLocaleString()}</span>}
                  </label>
                ))}
              </div>
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-blue-900">Transportation *</legend>
            <label className="flex gap-2 text-sm text-blue-950 font-medium items-start">
              <input type="radio" name="transport" checked={needsTransport === true} onChange={() => setNeedsTransport(true)} className="accent-blue-900 mt-1" />
              <span className="flex-1">
                <span className="block">Yes, I'll ride with the shop from the dive shop to the site</span>
                {!transportIncluded && transportSurcharge > 0 && (
                  <span className="block text-xs text-blue-950 font-medium">+{transportSurcharge.toLocaleString()} {event.currency}</span>
                )}
                {transportIncluded && (
                  <span className="block text-xs text-blue-950 font-medium">Included in base price</span>
                )}
              </span>
            </label>
            <label className="flex gap-2 text-sm text-blue-950 font-medium items-start">
              <input type="radio" name="transport" checked={needsTransport === false} onChange={() => setNeedsTransport(false)} className="accent-blue-900 mt-1" />
              <span className="flex-1">
                <span className="block">No, I don't need a ride</span>
                <span className="block text-xs text-blue-950 font-medium">
                  I am responsible for getting myself to the dive/event site on time.
                </span>
              </span>
            </label>
          </fieldset>

          {showNitroxAddon && (
            <label className="flex gap-2 text-sm text-blue-950 font-medium items-start">
              <input type="checkbox" checked={addNitroxCourse} onChange={e => setAddNitroxCourse(e.target.checked)} className="accent-blue-900 mt-1" />
              <span className="flex-1">
                <span className="block">Add Nitrox course (+{NITROX_COURSE_FEE.toLocaleString()})</span>
                <span className="block text-xs text-blue-950 font-medium">Get your Nitrox certification during this event.</span>
              </span>
            </label>
          )}

          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)"
            className="w-full bg-white border border-sky-300 rounded-lg px-2 py-1 text-sm text-blue-900" />
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
                  <span className="block">
                    {method === 'bank_transfer' && 'Bank transfer'}
                    {method === 'paypal' && 'PayPal (+5%)'}
                    {method === 'credit_card' && 'Credit card (+5%)'}
                    {method === 'cash' && 'Cash (in person at the shop)'}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {payment === 'credit_card' && (
            <label className="block">
              <span className="block text-xs text-blue-900 font-medium mb-1">
                Invoice email (optional)
              </span>
              <input
                type="email"
                value={creditCardInvoiceEmail}
                onChange={e => setCreditCardInvoiceEmail(e.target.value)}
                placeholder="Defaults to your registered email"
                className="w-full bg-white border border-sky-300 rounded-lg px-3 py-2 text-sm text-blue-900"
              />
            </label>
          )}

          <PaymentInstructionsBlock
            method={payment}
            invoiceEmail={payment === 'credit_card' ? creditCardInvoiceEmail.trim() || null : null}
          />

          <PaymentConfirmationReminderBlock />

          <div className="text-sm text-blue-950 font-medium bg-sky-50 rounded-lg p-3 space-y-1">
            <Row label="Base"                value={base} currency={event.currency} />
            {gearCost > 0         && <Row label="Gear"           value={gearCost}     currency={event.currency} />}
            {roomCost > 0         && <Row label="Room"           value={roomCost}     currency={event.currency} />}
            {addonsCost > 0       && <Row label="Add-ons"        value={addonsCost}   currency={event.currency} />}
            {transportCost > 0    && <Row label="Transport"      value={transportCost} currency={event.currency} />}
            {(showNitroxAddon && addNitroxCourse) && <Row label="Nitrox course" value={NITROX_COURSE_FEE} currency={event.currency} />}
            {paymentSurcharge > 0 && <Row label="Credit surcharge (5%)" value={total - subTotal} currency={event.currency} />}
            <div className="border-t border-sky-200 pt-1 mt-1">
              <Row label="Total" value={total} currency={event.currency} bold />
            </div>
          </div>

          {hasDeposit && (
            <div className="space-y-2">
              <p className="text-sm text-blue-950 font-medium font-semibold">How much to pay now</p>
              <label className="flex gap-2 text-sm text-blue-950 font-medium items-start">
                <input type="radio" name="pay-amount" checked={!payDepositOnly} onChange={() => setPayDepositOnly(false)} className="accent-blue-900 mt-1" />
                <span className="flex-1">
                  <span className="block">Pay full amount now</span>
                  <span className="block text-xs text-blue-950 font-medium">
                    {event.currency} {total.toLocaleString()} — settles your booking in one go.
                  </span>
                </span>
              </label>
              <label className="flex gap-2 text-sm text-blue-950 font-medium items-start">
                <input type="radio" name="pay-amount" checked={payDepositOnly} onChange={() => setPayDepositOnly(true)} className="accent-blue-900 mt-1" />
                <span className="flex-1">
                  <span className="block">Pay deposit only</span>
                  <span className="block text-xs text-blue-950 font-medium">
                    {event.currency} {(event.deposit_amount ?? 0).toLocaleString()} now, remainder due before the trip.
                  </span>
                </span>
              </label>
            </div>
          )}

          <div className="text-xs text-blue-950 font-medium bg-sky-50 border border-sky-200 rounded-lg p-3 space-y-1">
            <p>
              Pay deposit <strong>ASAP</strong> to hold your spot.
              Pay the remaining balance by <strong>{formatDeadline(fullPaymentDeadline)}</strong> to complete your registration.
            </p>
            {hasDeposit && payDepositOnly && (
              <div className="border-t border-sky-200 pt-1 mt-1 space-y-0.5">
                <p>
                  Pay deposit <strong>ASAP</strong>:{' '}
                  <strong>{event.currency} {(event.deposit_amount ?? 0).toLocaleString()}</strong>
                </p>
                <p>
                  Pay remaining balance by {formatDeadline(fullPaymentDeadline)}:{' '}
                  <strong>{event.currency} {Math.max(0, total - (event.deposit_amount ?? 0)).toLocaleString()}</strong>
                </p>
              </div>
            )}
          </div>

          {cancelPolicy && cancelPolicy.cancelation_policy && (
            <div className="text-xs text-blue-950 font-medium bg-white/70 border border-sky-300 rounded-lg p-3 space-y-2">
              <p className="font-semibold text-blue-900">
                Cancellation policy{cancelPolicy.title ? ` — ${cancelPolicy.title}` : ''}
              </p>
              {event.cancel_date && (
                <p>Cancel-by date: <strong>{formatDeadline(event.cancel_date)}</strong></p>
              )}
              <p className="whitespace-pre-line max-h-40 overflow-y-auto pr-1">
                {cancelPolicy.cancelation_policy}
              </p>
              <label className="flex items-start gap-2 pt-1">
                <input
                  type="checkbox"
                  checked={policyAcked}
                  onChange={e => setPolicyAcked(e.target.checked)}
                  className="accent-blue-900 mt-0.5"
                />
                <span>I have read and agree to the cancellation policy.</span>
              </label>
            </div>
          )}

          {!isEdit && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-500 rounded p-2">
              Please note: your reservation is not confirmed until the deposit
              {event.deposit_amount != null && ` (${event.currency} ${event.deposit_amount.toLocaleString()})`} has been paid.
            </p>
          )}

          {err && <p className="text-red-600 text-sm">{err}</p>}
        </section>
      )}

      <footer className="flex items-center justify-between gap-2 pt-2">
        <button
          onClick={() => {
            if (step === 1) onBackBeforeStepOne?.()
            else setStep((step - 1) as Step)
          }}
          disabled={step === 1 && !onBackBeforeStepOne}
          className="text-sm text-blue-900 font-medium hover:text-blue-900 disabled:opacity-40"
        >
          ‹ Back
        </button>
        {step < 4 ? (
          <button
            onClick={() => setStep((step + 1) as Step)}
            disabled={
              (step === 2 && (
                fullName.trim() === '' ||
                certBlocked ||
                nitroxBlocked ||
                (isGuest && (guestEmail.trim() === '' || guestPassword.length < 8 || !guestAgreedTerms))
              )) ||
              (step === 3 && needsTransport === null)
            }
            className="bg-blue-900 hover:bg-blue-950 disabled:opacity-40 text-white text-sm font-semibold py-2 px-4 rounded-lg"
          >
            Next ›
          </button>
        ) : (
          <button onClick={submit} disabled={saving || (!!cancelPolicy && !policyAcked)}
            className="bg-blue-900 hover:bg-blue-950 disabled:opacity-40 text-white text-sm font-semibold py-2 px-4 rounded-lg">
            {saving ? '…' : isEdit ? 'Save changes' : 'Confirm booking'}
          </button>
        )}
      </footer>
    </>
  )
}

function Row({ label, value, currency, bold = false }: { label: string; value: number; currency: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold text-blue-900' : ''}`}>
      <span>{label}</span>
      <span>{currency} {value.toLocaleString()}</span>
    </div>
  )
}

// 'YYYY-MM-DD' → 'EEE, MMM d' (e.g. 'Sat, May 1'). Matches the calendar copy.
function formatDeadline(yyyyMmDd: string): string {
  return format(parseISO(yyyyMmDd + 'T00:00:00'), 'EEE, MMM d')
}

function PaymentInstructionsBlock({
  method, invoiceEmail,
}: {
  method: 'bank_transfer' | 'credit_card' | 'paypal' | 'cash'
  invoiceEmail?: string | null
}) {
  const instr = paymentInstructionsFor(method, { invoiceEmail })
  return (
    <div className="text-xs text-blue-950 font-medium bg-white/70 border border-sky-200 rounded-lg p-3 space-y-1">
      <p className="font-semibold text-blue-900">{instr.title}</p>
      {instr.lines.map((line, i) => <PaymentInstructionLine key={i} line={line} />)}
    </div>
  )
}

// "After you pay" reminder block — same copy for every method so the diver
// always sees how to confirm receipt with the shop and where to watch for
// status updates.
function PaymentConfirmationReminderBlock() {
  const reminder = paymentConfirmationReminder()
  return (
    <div className="text-xs text-blue-950 font-medium bg-amber-50 border border-amber-300 rounded-lg p-3 space-y-1">
      <p className="font-semibold text-blue-900">{reminder.title}</p>
      {reminder.lines.map((line, i) => <PaymentInstructionLine key={i} line={line} />)}
    </div>
  )
}

// Render a single instruction line, turning bare https URLs into clickable
// anchors so tapping the paypal.me / Google Maps link Just Works on mobile.
// The PDF version stays plain text — jsPDF doesn't carry hyperlinks well.
function PaymentInstructionLine({ line }: { line: string }) {
  const urlMatch = line.match(/(https?:\/\/\S+)/)
  if (!urlMatch) return <p>{line}</p>
  const url = urlMatch[1]
  const before = line.slice(0, urlMatch.index)
  const after = line.slice((urlMatch.index ?? 0) + url.length)
  return (
    <p>
      {before}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-700 underline break-all"
      >
        {url}
      </a>
      {after}
    </p>
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
      <span className="block text-xs text-blue-900 font-medium mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        min={min}
        className="w-full bg-white border border-sky-300 rounded-lg px-2 py-2 text-sm text-blue-900 focus:outline-none focus:border-blue-900"
      />
    </label>
  )
}
