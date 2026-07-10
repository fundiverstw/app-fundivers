import { useEffect, useMemo, useRef, useState } from 'react'
import { personName } from '../../lib/names'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { CURRENT_TERMS_VERSION } from '../../lib/terms-version'
import { formatEventSpan, eventIsFull, isPastEvent } from '../../lib/events'
import { useAuth } from '../../hooks/useAuth'
import { computeEffectiveFullPaymentDeadline } from '../../lib/payment-deadlines'
import { paymentInstructionsFor } from '../../lib/payment-instructions'
import { GEAR_ITEMS, GEAR_ALACARTE_PRICES, isGearIncludedCourse } from '../../lib/gear'
import { siteConfig } from '../../config/site'
import { t } from '../../i18n'
import { buildCharges, NITROX_COURSE_FEE } from '../../lib/booking-charges'
import { fetchCreditsForUser, openCreditBalance, applyCreditToBooking } from '../../lib/credits'
import { invokeWithRetry } from '../../lib/edge-invoke'
import { fetchRideSeats, canRequestRide, type RideSeats } from '../../lib/event-vehicles'
import { missingWaivers, fetchEventWaiverOverrides, fetchDiverSignatures, fetchWaivers } from '../../lib/waivers'
import { WaiverSignDialog } from '../waivers/WaiverSignDialog'
import type { WaiverDef } from '../../config/waivers'
import { PasswordInput } from '../PasswordInput'
import { uploadCertCard } from '../../lib/cert-card'
import { uploadNitroxCard } from '../../lib/nitrox-card'
import { uploadDeepCard } from '../../lib/deep-card'
import { isHeicFile } from '../../lib/image-compress'
import { TurnstileWidget } from './TurnstileWidget'
import { WhatHappensNext } from './WhatHappensNext'
import { DateField } from '../DateField'
import { ShoeSizeField } from '../ShoeSizeField'
import {
  registrationDraftKey,
  loadRegistrationDraft,
  saveRegistrationDraft,
  clearRegistrationDraft,
  type RegistrationDraft,
} from '../../lib/registration-draft'
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
  /** Diver-facing modal flow: after a successful submit, show a "What happens
   *  next" panel inside the modal (and defer onBooked until the diver taps
   *  Done) instead of closing silently. Off for admin / edit flows. */
  inlineConfirmation?: boolean
}

export function RegisterForm({ event, profile, userId, onClose, onBooked, existingBooking, inlineConfirmation }: Props) {
  return (
    <div className="fixed inset-0 bg-brand-900/60 backdrop-blur-sm flex items-start justify-center z-50 px-4 pt-8 pb-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-white/80 backdrop-blur-md border border-accent rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <RegisterFormBody
          event={event}
          profile={profile}
          userId={userId}
          onSubmitSuccess={onBooked}
          onCancel={onClose}
          existingBooking={existingBooking}
          inlineConfirmation={inlineConfirmation}
        />
      </div>
    </div>
  )
}

// Per-event transport surcharge now lives on the linked prices row
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
    return t.register.errors.emailExists
  }
  return msg
}

// Read back a diver's own active booking for an event — used to recover from a
// lost create-registration response, where the booking actually landed but the
// network dropped before the reply reached the form.
async function fetchOwnBooking(
  userId: string,
  event: AppEvent,
): Promise<{ id: string; status: string } | null> {
  const { data } = await supabase
    .from('bookings')
    .select('id, status')
    .eq('user_id', userId)
    .eq('event_id', event.id)
    .neq('status', 'cancelled')
    .maybeSingle()
  return (data as { id: string; status: string } | null) ?? null
}

type Step = 1 | 2 | 3 | 4
type ContactMethod = 'whatsapp' | 'line' | 'phone' | 'email'
type GearChoice = 'none' | 'rent' | 'help'

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
  /** Show the inline "What happens next" confirmation panel after a
   *  successful (non-edit, non-on-behalf) submit, deferring onSubmitSuccess
   *  until the diver dismisses it. The standalone /register page leaves this
   *  off — it has its own LockedConfirmation success screen. */
  inlineConfirmation?: boolean
}

// Outer wrapper around the multi-step form. Adds an optional "Who is this
// booking for?" picker for authed parents with linked child accounts. The
// picker is multi-select — a parent can register themselves and any
// number of their children in one go (all bookings share a group_id and
// the same extras / payment choices).
//
// Picker UX: the inner form renders immediately so guests / childless
// divers see no loading state at all. We fetch the caller's linked
// children in the background; if any come back, we swap to the picker
// before the parent's done with step 1.
export function RegisterFormBody(props: RegisterFormBodyProps) {
  const { profile, userId, existingBooking, actingOnBehalfOf } = props
  // The picker is only relevant for fresh bookings made by an authed user
  // who isn't already acting on someone else's behalf.
  const pickerEligible = !!userId && !actingOnBehalfOf && !existingBooking
    // A diver who already has a parent can't themselves be a parent — skip
    // the fetch entirely.
    && !profile?.parent_account

  const [children, setChildren] = useState<Profile[]>([])
  // Profiles the parent has picked (may include themselves). Empty array
  // is the implicit "self only" default for the no-children case.
  const [selectedDivers, setSelectedDivers] = useState<Profile[]>([])
  // True once the picker has been shown and acknowledged (or there's no
  // picker to show in the first place). Starts true so the form renders
  // immediately — flips to false when the children fetch turns up at
  // least one linked diver, triggering the picker.
  const [pickerConfirmed, setPickerConfirmed] = useState(true)

  useEffect(() => {
    if (!pickerEligible || !userId) return
    let cancelled = false
    supabase
      .from('profiles')
      .select('*')
      .eq('parent_account', userId)
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return
        const rows = (data ?? []) as Profile[]
        if (rows.length > 0) {
          setChildren(rows)
          setPickerConfirmed(false)
        }
      })
    return () => { cancelled = true }
  }, [pickerEligible, userId])

  // Admin-on-behalf and edit paths don't go through the picker at all —
  // their target is already pinned by the caller. Pass straight through.
  if (!pickerEligible) {
    return <RegisterFormBodyInner {...props} />
  }

  if (!pickerConfirmed && profile && children.length > 0) {
    return (
      <DiverPickerStep
        parent={profile}
        childOptions={children}
        eventTitle={props.event.title}
        initialSelection={selectedDivers.length > 0 ? selectedDivers : [profile]}
        onCancel={props.onCancel ?? props.onBackBeforeStepOne}
        onConfirm={(selection) => {
          setSelectedDivers(selection)
          setPickerConfirmed(true)
        }}
      />
    )
  }

  // When the picker has been seen, selectedDivers drives the form.
  // When it hasn't (no children), fall back to the parent as the lone
  // target — same as before the multi-picker existed.
  const effectiveSelection = selectedDivers.length > 0
    ? selectedDivers
    : (profile ? [profile] : [])

  const includesSelf = !!userId && effectiveSelection.some(d => d.id === userId)
  const childSelections = effectiveSelection.filter(d => d.id !== userId)
  // The primary target prefills form fields + handles uploads (parent's
  // session can only write to their own storage folder). When self is in
  // the selection, primary = parent. Otherwise primary is the first
  // child and uploads are skipped (on-behalf mode).
  const primaryProfile = includesSelf ? profile : (childSelections[0] ?? profile)
  const primaryActingOnBehalfOf = includesSelf
    ? actingOnBehalfOf
    : (childSelections[0]?.id ?? actingOnBehalfOf)
  // Children NOT used as the primary still get a booking — fanned out
  // server-side from the inner form's submit handler.
  const additionalTargets: Profile[] = includesSelf
    ? childSelections
    : childSelections.slice(1)

  const headerLabel = formatSelectionLabel(effectiveSelection, userId ?? null)

  // When the parent's selection includes any child, they (the lead booker)
  // can be the single payer for the whole group. Null otherwise — including
  // the admin-on-behalf / edit paths above, which never reach here.
  const leadPayerId = childSelections.length > 0 ? (userId ?? null) : null

  return (
    <RegisterFormBodyInner
      {...props}
      key={`${primaryProfile?.id ?? 'guest'}::${additionalTargets.map(t => t.id).join(',')}`}
      profile={primaryProfile}
      actingOnBehalfOf={primaryActingOnBehalfOf}
      additionalTargets={additionalTargets}
      leadPayerId={leadPayerId}
      pickerHeader={children.length > 0 && headerLabel ? {
        targetName: headerLabel,
        onChange: () => { setPickerConfirmed(false) },
      } : null}
    />
  )
}

function formatSelectionLabel(selection: Profile[], selfId: string | null): string | null {
  if (selection.length === 0) return null
  const names = selection.map(p =>
    (selfId && p.id === selfId)
      ? t.register.picker.myself
      : (personName(p.name, p.nickname) || t.register.picker.unnamed)
  )
  return names.join(', ')
}

interface PickerHeaderInfo {
  targetName: string
  onChange: () => void
}

function DiverPickerStep({
  parent, childOptions, eventTitle, initialSelection, onConfirm, onCancel,
}: {
  parent: Profile
  childOptions: Profile[]
  eventTitle: string
  initialSelection: Profile[]
  onConfirm: (selection: Profile[]) => void
  onCancel?: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelection.map(p => p.id))
  )
  const all: Profile[] = [parent, ...childOptions]

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const canContinue = selected.size > 0

  return (
    <>
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold text-brand-900 leading-tight">{eventTitle}</h1>
          {onCancel && (
            <button onClick={onCancel} className="text-brand-900 font-medium text-xl leading-none shrink-0" aria-label={t.register.close}>×</button>
          )}
        </div>
        <p className="text-xs text-brand-900 font-medium">{t.register.picker.whoFor}</p>
      </header>
      <ul className="space-y-2">
        {all.map(p => {
          const isSelf = p.id === parent.id
          const checked = selected.has(p.id)
          return (
            <li key={p.id}>
              <label
                className={`flex items-start gap-3 cursor-pointer bg-white/70 hover:bg-surface-100 border rounded-lg px-3 py-3 ${
                  checked ? 'border-brand-700 ring-2 ring-brand-200' : 'border-surface-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(p.id)}
                  aria-label={isSelf ? t.register.picker.myself : (p.name ?? t.register.picker.unnamedChild)}
                  className="accent-brand-900 mt-1"
                />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-brand-900">
                    {isSelf ? t.register.picker.myself : (
                      <>
                        {p.name ?? t.register.picker.noName}
                        {p.nickname && <span className="text-brand-900/80"> ({p.nickname})</span>}
                      </>
                    )}
                  </p>
                  <p className="text-xs text-brand-900/70">
                    {isSelf
                      ? (personName(p.name, p.nickname) || t.register.picker.yourAccount)
                      : (p.cert_agency && p.cert_level ? `${p.cert_agency} ${p.cert_level}` : t.register.picker.uncertified)}
                    {!isSelf && p.status && p.status !== 'active' && (
                      <span className="ml-2 uppercase tracking-wider text-red-700">{p.status}</span>
                    )}
                  </p>
                </div>
              </label>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-brand-950 font-medium">
        {t.register.picker.eachDiver}
      </p>
      <footer className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          disabled={!canContinue}
          onClick={() => {
            const sel = all.filter(p => selected.has(p.id))
            onConfirm(sel)
          }}
          className="bg-brand-900 hover:bg-brand-950 disabled:opacity-40 text-white text-sm font-semibold py-2 px-4 rounded-lg"
        >
          {t.register.picker.continueArrow}
        </button>
      </footer>
    </>
  )
}

interface RegisterFormBodyInnerProps extends RegisterFormBodyProps {
  pickerHeader?: PickerHeaderInfo | null
  /** Additional divers to register in the same submit. Each becomes a
   *  parallel create-registration call with target_user_id set and an
   *  empty profile_patch (so the parent's typed values don't overwrite
   *  the child's profile). All calls share one group_id. */
  additionalTargets?: Profile[]
  /** When set, the lead booker (this id) can opt to pay for the whole
   *  family group: every booking in the submit is stamped with payer_id =
   *  leadPayerId so the balance consolidates onto the lead's account. Null
   *  on solo / admin-on-behalf bookings. */
  leadPayerId?: string | null
}

function RegisterFormBodyInner({ event, profile, userId, onSubmitSuccess, onCancel, onBackBeforeStepOne, existingBooking, actingOnBehalfOf, pickerHeader, additionalTargets = [], leadPayerId = null, inlineConfirmation = false }: RegisterFormBodyInnerProps) {
  const isGuest = !userId && !actingOnBehalfOf
  const isEdit = !!existingBooking
  // Read at render (not module load) so tests can stub it per-case. A guest
  // signup is gated by Cloudflare Turnstile, and the create-registration edge
  // function rejects any guest request without a verified token. If the bundle
  // ships without a site key the widget can't render and there's nothing to
  // solve — so when the key is absent we block the guest path with a clear
  // notice instead of letting the diver fill the whole form and dead-end on a
  // "captcha token required" error at submit.
  const turnstileSiteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '') as string
  // On-behalf-of (admin or parent): relax the diver-facing required-field
  // gates so the caller can register a diver whose profile is still
  // incomplete (no cert card, missing full name, no transport choice, no
  // policy ack). The target diver can complete their profile later.
  //
  // We also skip card-photo uploads in this mode entirely — admins upload
  // from AdminUsersPage, parents lack the storage-RLS access to write
  // under another user's folder, and either way the target diver can
  // upload from /profile later.
  const isOnBehalfOf = !!actingOnBehalfOf
  // A signed-in diver booking only for themselves can spend their in-store
  // account credit on the new booking right at checkout. Guests (brand-new
  // accounts), edits, on-behalf-of, and family-group submits are excluded —
  // group leads use the Payments page to apply credit to the consolidated
  // balance afterward.
  const creditEligible = !!userId && !isGuest && !isEdit && !isOnBehalfOf
    && additionalTargets.length === 0 && !leadPayerId
  const initialDetails = existingBooking?.details as BookingDetails | undefined
  // Registration is closed for events that have already happened — but admins
  // and staff keep full control (e.g. recording a booking after the fact) and
  // the admin edit path is always allowed. Guests (no session) are never
  // privileged, so a deep-link to a past event is blocked too.
  const { profile: viewerProfile } = useAuth()
  const viewerPrivileged = viewerProfile?.role === 'admin' || viewerProfile?.role === 'staff'
  const pastBlocked = !isEdit && !viewerPrivileged && isPastEvent(event)
  // Gating derived from the event
  const diveDays = Math.max(1, event.dive_days ?? 1)
  // Open Water / DSD courses bundle gear into the fee — we record the fact
  // in the booking but don't prompt. Every other course (AOW, EANx, Deep,
  // Rescue, ...) lets the diver rent, same as a dive. Dives expose the rent
  // toggle when the admin filled in gear_rental_info on the dive event.
  const gearIncluded = event.type === 'course' && isGearIncludedCourse(event.title)
  const showGearRentChoice =
    (event.type === 'dive' && !!event.gear_rental_info) ||
    (event.type === 'course' && !isGearIncludedCourse(event.title))
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
  // Per-additional-target results from a multi-diver fan-out. Surfaced on
  // step 4 after submit so partial failures stay visible (e.g. parent's
  // own booking landed but one child's failed) and can be retried.
  const [additionalResults, setAdditionalResults] = useState<
    Array<{ targetName: string; ok: boolean; error?: string }>
  >([])
  // Inline-confirmation terminal state: a successful submit parks the booking
  // result here so the modal can show "What happens next" before handing back
  // to the parent (deferred onSubmitSuccess) on Done. Null = still in the form.
  const [doneInline, setDoneInline] = useState<{ id: string; status: string } | null>(null)

  // Form state — pre-populated from existingBooking when editing.
  // Gear is a single three-way choice: 'none' (diver has everything),
  // 'rent' (pick items to rent), or 'help' (unsure — leave a note for staff).
  // null = not yet chosen on a new booking; step-3 Next is gated until set.
  const initialGearChoice: GearChoice | null = initialDetails?.gear
    ? (initialDetails.gear.assistance_note ? 'help' : initialDetails.gear.rent ? 'rent' : 'none')
    : null
  const [gearChoice, setGearChoice] = useState<GearChoice | null>(initialGearChoice)
  const [gearHelpNote, setGearHelpNote] = useState(initialDetails?.gear?.assistance_note ?? '')
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
  // Rental gear needs sizes on file: shoe size for Fins/Boots, height + weight
  // for Wetsuit/BCD. When the diver's profile is missing the relevant size we
  // collect it here and save it back to their profile on submit.
  const [shoeSize, setShoeSize] = useState(profile?.shoe_size ?? '')
  const [heightCm, setHeightCm] = useState(profile?.height_cm != null ? String(profile.height_cm) : '')
  const [weightKg, setWeightKg] = useState(profile?.weight_kg != null ? String(profile.weight_kg) : '')
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
  // Ride-seat tally from the cars assigned to this dive — gates the "I need a
  // ride" option when the assigned fleet is full. null until loaded.
  const [rideSeats, setRideSeats] = useState<RideSeats | null>(null)
  // Waivers the diver still needs for this event (null = not yet computed).
  // Advisory only — surfaced on step 4 but never blocks submit.
  const [missingW, setMissingW] = useState<WaiverDef[] | null>(null)
  const [signingW, setSigningW] = useState<WaiverDef | null>(null)
  const [addNitroxCourse, setAddNitroxCourse] = useState(initialDetails?.nitrox_course_addon ?? false)
  const [payment, setPayment] = useState<'bank_transfer' | 'credit_card' | 'paypal' | 'cash'>(
    initialDetails?.payment_method ?? 'bank_transfer'
  )
  const [creditCardInvoiceEmail, setCreditCardInvoiceEmail] = useState<string>(
    initialDetails?.credit_card_invoice_email ?? ''
  )
  // Lead booker pays for the whole family group. Only offered (and only
  // meaningful) when leadPayerId is set, i.e. the selection includes a child.
  const [payForEveryone, setPayForEveryone] = useState(true)
  const leadPays = !!leadPayerId && payForEveryone
  // Spendable account credit for a self-booking diver, plus their opt-in to
  // apply it at checkout (default on — use credit before paying out of pocket).
  // creditApplied records what the RPC actually consumed, for the success view.
  const [availableCredit, setAvailableCredit] = useState(0)
  const [useAccountCredit, setUseAccountCredit] = useState(true)
  const [creditApplied, setCreditApplied] = useState(0)
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
  const [fullName, setFullName]  = useState(profile?.name  ?? '')
  const [nickname, setNickname]  = useState(profile?.nickname  ?? '')
  const [dob, setDob]            = useState(profile?.date_of_birth ?? '')
  const [nationality, setNationality] = useState(profile?.nationality ?? '')
  const [gender, setGender]      = useState(profile?.gender     ?? '')
  const [idNumber, setIdNumber]  = useState(profile?.id_number  ?? '')
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
  // Deep (40m) cert mirrors the nitrox pattern: boolean flag + photo
  // required when claimed.
  const [deepCertified, setDeepCertified] = useState(profile?.deep_certified ?? false)
  const [deepFile, setDeepFile] = useState<File | null>(null)
  const [deepFileErr, setDeepFileErr] = useState<string | null>(null)
  const hasDeepCardOnFile = !!profile?.deep_card_path
  const deepBlocked = deepCertified && !hasDeepCardOnFile && !deepFile
  // Same pattern for the main cert card: cert_level set ⇒ photo required.
  // The card stays optional for divers who haven't picked a level (they
  // can still register, e.g. for an entry-level course).
  const [certFile, setCertFile] = useState<File | null>(null)
  const [certFileErr, setCertFileErr] = useState<string | null>(null)
  // Diver explicitly holds no certification (Discover / trial diver). Mutually
  // exclusive with naming a cert level — one of the two is mandatory below.
  const [uncertified, setUncertified] = useState(profile?.uncertified ?? false)
  // Acknowledgment that the diver will bring their physical card when they
  // choose to defer the photo upload (see the disclaimer on step 2).
  const [certCardAck, setCertCardAck] = useState(false)
  const hasCertCardOnFile = !!profile?.cert_card_path
  // Certification is mandatory for a diver's own registration: they must
  // either name a level or declare themselves uncertified. The photo is
  // deferrable — a named level with no card on file can proceed once the
  // diver either picks a photo or acknowledges they'll bring the physical
  // card (or be turned away, no refund).
  const certDeclarationBlocked = !isOnBehalfOf && !uncertified && certLevel.trim() === ''
  const needsCertPhoto = !uncertified && certLevel.trim() !== '' && !hasCertCardOnFile && !certFile
  const certPhotoBlocked = !isOnBehalfOf && needsCertPhoto && !certCardAck

  // Event prerequisites resolved from the catalog row (a required cert and/or a
  // minimum logged-dive count). When the diver's self-reported profile falls
  // short we warn and let them acknowledge (bring proof) rather than hard-block
  // — the server applies the same rule via the prereq_acked_at stamp.
  const [prereqCertName, setPrereqCertName] = useState<string | null>(null)
  const [prereqReqDives, setPrereqReqDives] = useState<number | null>(null)
  const [prereqAck, setPrereqAck] = useState(false)
  const prereqCertMismatch = !isOnBehalfOf && !!prereqCertName && uncertified
  const prereqDivesMismatch = !isOnBehalfOf && prereqReqDives != null && loggedDives < prereqReqDives
  const prereqMismatch = prereqCertMismatch || prereqDivesMismatch
  const prereqBlocked = prereqMismatch && !prereqAck

  // Size requirements for the gear being rented (Fins/Boots → shoe size;
  // Wetsuit/BCD → height + weight). We only prompt for sizes the profile is
  // missing; once present, the booking just reuses them.
  const rentingGear = showGearRentChoice && gearChoice === 'rent'
  const rentedItems = rentingGear ? gearItems : []
  const askShoe   = (rentedItems.includes('Fins') || rentedItems.includes('Boots')) && !profile?.shoe_size
  const askBody   = rentedItems.includes('Wetsuit') || rentedItems.includes('BCD')
  const askHeight = askBody && profile?.height_cm == null
  const askWeight = askBody && profile?.weight_kg == null
  const shoeMissing   = askShoe   && !shoeSize.trim()
  const heightMissing = askHeight && !(Number(heightCm) > 0)
  const weightMissing = askWeight && !(Number(weightKg) > 0)
  // Admins/parents acting on behalf can fill sizes later — only gate the
  // diver's own registration (matches the cert / transport gating).
  const sizesBlocked = !isOnBehalfOf && (shoeMissing || heightMissing || weightMissing)

  const [emergencyName, setEmergencyName]   = useState(profile?.emergency_contact_name  ?? '')
  const [emergencyPhone, setEmergencyPhone] = useState(profile?.emergency_contact_phone ?? '')

  // Gender and nationality are mandatory on a diver's own profile — block the
  // step-2 Next until both are set. Relaxed on the on-behalf-of paths (admin /
  // parent), same as the other diver-facing required-field gates; the target
  // diver completes their profile later.
  const profileFieldsBlocked = !isOnBehalfOf && (nationality.trim() === '' || gender.trim() === '')

  // Guest-mode credentials — only collected when the visitor isn't signed in.
  // At submit, we signUp with these before inserting the booking.
  const [guestEmail, setGuestEmail] = useState('')
  const [guestPassword, setGuestPassword] = useState('')
  const [guestAgreedTerms, setGuestAgreedTerms] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)

  // Local resume: autosave the diver's in-progress answers to localStorage so a
  // dropped connection or closed tab doesn't force a restart of the four-step
  // form. Only the diver's own fresh registration is drafted — admin edits and
  // on-behalf-of / multi-target flows target someone else and stay ephemeral.
  const draftEnabled = !isEdit && !isOnBehalfOf && additionalTargets.length === 0
  const draftKey = draftEnabled ? registrationDraftKey(event.type, event.id, userId ?? null) : null
  // Snapshot any saved draft once, at mount, before the autosave effect can
  // overwrite storage — this powers the "resume?" banner from memory.
  const [savedDraft] = useState<RegistrationDraft | null>(() => (draftKey ? loadRegistrationDraft(draftKey) : null))
  const [resumeResolved, setResumeResolved] = useState(false)
  const showResumeBanner = !!savedDraft && !resumeResolved

  // Skip the very first render so mounting (form pre-filled from profile
  // defaults) doesn't overwrite a saved draft before the diver resumes it.
  // After that, every change re-saves (debounced) the serializable answers.
  const firstAutosave = useRef(true)
  useEffect(() => {
    if (!draftKey) return
    if (firstAutosave.current) { firstAutosave.current = false; return }
    const draft: RegistrationDraft = {
      savedAt: Date.now(),
      step,
      fullName, nickname, dob, nationality, gender, idNumber,
      contactMethod, contactId, certAgency, certLevel, uncertified, loggedDives,
      nitroxCertified, deepCertified, emergencyName, emergencyPhone,
      guestEmail, guestAgreedTerms,
      gearChoice, gearHelpNote, editedGearItems,
      shoeSize, heightCm, weightKg,
      roomId, roomNotes, addonIds: Array.from(addonIds),
      needsTransport, addNitroxCourse,
      payment, creditCardInvoiceEmail, payForEveryone, useAccountCredit, payDepositOnly,
      notes,
    }
    const t = setTimeout(() => saveRegistrationDraft(draftKey, draft), 400)
    return () => clearTimeout(t)
  }, [
    draftKey, step, fullName, nickname, dob, nationality, gender, idNumber,
    contactMethod, contactId, certAgency, certLevel, uncertified, loggedDives,
    nitroxCertified, deepCertified, emergencyName, emergencyPhone,
    guestEmail, guestAgreedTerms, gearChoice, gearHelpNote, editedGearItems,
    shoeSize, heightCm, weightKg, roomId, roomNotes, addonIds,
    needsTransport, addNitroxCourse, payment, creditCardInvoiceEmail,
    payForEveryone, useAccountCredit, payDepositOnly, notes,
  ])

  function applyDraft(d: RegistrationDraft) {
    setStep(Math.min(4, Math.max(1, d.step)) as Step)
    setFullName(d.fullName)
    setNickname(d.nickname)
    setDob(d.dob)
    setNationality(d.nationality)
    setGender(d.gender)
    setIdNumber(d.idNumber)
    setContactMethod(d.contactMethod as ContactMethod | '')
    setContactId(d.contactId)
    setCertAgency(d.certAgency)
    setCertLevel(d.certLevel)
    setUncertified(d.uncertified)
    setLoggedDives(d.loggedDives)
    setNitroxCertified(d.nitroxCertified)
    setDeepCertified(d.deepCertified)
    setEmergencyName(d.emergencyName)
    setEmergencyPhone(d.emergencyPhone)
    setGuestEmail(d.guestEmail)
    setGuestAgreedTerms(d.guestAgreedTerms)
    setGearChoice(d.gearChoice as GearChoice | null)
    setGearHelpNote(d.gearHelpNote)
    setEditedGearItems(d.editedGearItems)
    setShoeSize(d.shoeSize)
    setHeightCm(d.heightCm)
    setWeightKg(d.weightKg)
    setRoomId(d.roomId)
    setRoomNotes(d.roomNotes)
    setAddonIds(new Set(d.addonIds))
    setNeedsTransport(d.needsTransport)
    setAddNitroxCourse(d.addNitroxCourse)
    setPayment(d.payment as 'bank_transfer' | 'credit_card' | 'paypal' | 'cash')
    setCreditCardInvoiceEmail(d.creditCardInvoiceEmail)
    setPayForEveryone(d.payForEveryone)
    setUseAccountCredit(d.useAccountCredit)
    setPayDepositOnly(d.payDepositOnly)
    setNotes(d.notes)
    setResumeResolved(true)
  }

  function discardDraft() {
    if (draftKey) clearRegistrationDraft(draftKey)
    setResumeResolved(true)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (showRooms && event.room_type_ids.length > 0) {
        const { data } = await supabase
          .from('rooms' as never)
          .select('id, admin_title, display_title, added_price, currency')
          .in('id', event.room_type_ids)
        if (!cancelled) setRooms((data ?? []) as EORoom[])
      }
      if (showAddons && event.addon_ids.length > 0) {
        const { data } = await supabase
          .from('addons' as never)
          .select('id, admin_title, display_title, price, currency')
          .in('id', event.addon_ids)
        if (!cancelled) setAddons((data ?? []) as EOAddon[])
      }
      if (event.cancel_policy) {
        const { data } = await supabase
          .from('cancellation_policies' as never)
          .select('id, title, cancellation_policy')
          .eq('id', event.cancel_policy)
          .maybeSingle()
        if (!cancelled) setCancelPolicy((data ?? null) as CancellationPolicy | null)
      }
    })()
    return () => { cancelled = true }
  }, [event.id, showRooms, showAddons, event.room_type_ids, event.addon_ids, event.cancel_policy])

  // Load the diver's spendable account credit so step 4 can offer to apply it.
  // Best-effort: a failure just hides the option (the diver can still use the
  // Payments page later).
  useEffect(() => {
    if (!creditEligible || !userId) return
    let cancelled = false
    fetchCreditsForUser(userId)
      .then(rows => { if (!cancelled) setAvailableCredit(openCreditBalance(rows)) })
      .catch(() => { /* no credit option shown on failure */ })
    return () => { cancelled = true }
  }, [creditEligible, userId])

  // Load this dive's ride-seat tally to gate the transport opt-in. Best-effort:
  // on failure rideSeats stays null and the gate fails open (option offered).
  useEffect(() => {
    if (event.type !== 'dive') return
    let cancelled = false
    fetchRideSeats({ dive_id: event.id })
      .then(seats => { if (!cancelled) setRideSeats(seats) })
      .catch(() => { /* fail open — no gate */ })
    return () => { cancelled = true }
  }, [event.type, event.id])

  // Resolve the event's prerequisites (required cert name + minimum logged
  // dives) so step 2 can warn a diver who doesn't meet them. Best-effort: on
  // failure no warning shows (the server still enforces the ack).
  useEffect(() => {
    if (isOnBehalfOf) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('events' as never)
        .select('prereq_cert_id, req_dives')
        .eq('id', event.id)
        .maybeSingle()
      if (cancelled || !data) return
      const row = data as { prereq_cert_id: string | null; req_dives: number | string | null }
      let certName: string | null = null
      if (row.prereq_cert_id) {
        const { data: cl } = await supabase
          .from('cert_levels' as never)
          .select('name')
          .eq('id', row.prereq_cert_id)
          .maybeSingle()
        certName = (cl as { name?: string } | null)?.name ?? t.register.prereq.higherCertFallback
      }
      const digits = typeof row.req_dives === 'number'
        ? row.req_dives
        : (typeof row.req_dives === 'string' && row.req_dives.replace(/\D/g, '') !== ''
            ? Number(row.req_dives.replace(/\D/g, ''))
            : null)
      if (!cancelled) {
        setPrereqCertName(certName)
        setPrereqReqDives(digits != null && Number.isFinite(digits) ? digits : null)
      }
    })()
    return () => { cancelled = true }
  }, [event.type, event.id, isOnBehalfOf])

  // Waivers the diver still needs for this event. Only computed for a diver
  // registering themselves (the e-signature is signed as auth.uid(), so it
  // doesn't apply to guests, on-behalf-of, or admin edits). Advisory: it shows a
  // warning + inline "Sign now" on step 4 but never blocks the booking.
  const waiverEligible = !!userId && !isGuest && !isEdit && !isOnBehalfOf
  const eventRef = { id: event.id, type: event.type, title: event.title }

  async function refreshMissingWaivers() {
    if (!userId) return
    try {
      const [overrides, sigs, waivers] = await Promise.all([
        fetchEventWaiverOverrides(event.type === 'dive' ? { dive_id: event.id } : { course_id: event.id }),
        fetchDiverSignatures(userId),
        fetchWaivers(),
      ])
      setMissingW(missingWaivers(eventRef, overrides, sigs, new Date(), waivers))
    } catch { /* keep the current list on a refresh failure */ }
  }

  useEffect(() => {
    if (!waiverEligible || !userId) return
    let cancelled = false
    ;(async () => {
      try {
        const [overrides, sigs, waivers] = await Promise.all([
          fetchEventWaiverOverrides(event.type === 'dive' ? { dive_id: event.id } : { course_id: event.id }),
          fetchDiverSignatures(userId),
          fetchWaivers(),
        ])
        if (!cancelled) {
          setMissingW(missingWaivers({ id: event.id, type: event.type, title: event.title }, overrides, sigs, new Date(), waivers))
        }
      } catch { /* fail open — no warning shown on error */ }
    })()
    return () => { cancelled = true }
  }, [waiverEligible, userId, event.id, event.type, event.title])

  const gearCost = useMemo(() => {
    if (!showGearRentChoice || gearChoice !== 'rent') return 0
    return gearItems.reduce((s, item) => s + (GEAR_ALACARTE_PRICES[item] ?? 0) * diveDays, 0)
  }, [showGearRentChoice, gearChoice, gearItems, diveDays])

  const roomCost = useMemo(() => rooms.find(r => r.id === roomId)?.added_price ?? 0, [rooms, roomId])
  const addonsCost = useMemo(() => {
    let total = 0
    for (const a of addons) if (addonIds.has(a.id)) total += a.price ?? 0
    return total
  }, [addons, addonIds])
  // Both PayPal and credit card incur a 5% surcharge (PayPal absorbs ~3% on
  // paypal.me transfers; the card processor's fee is similar). Cash and
  // local bank transfer pass through at face value.
  const paymentSurcharge = payment === 'credit_card' || payment === 'paypal' ? 0.05 : 0
  const base = event.price ?? 0
  // Transport pricing comes from the linked prices row. NULL or 0 means
  // it's bundled into the base price — the form hides the opt-in checkbox
  // and the cost calc skips the surcharge entirely.
  const transportSurcharge = event.transport_price ?? 0
  const transportIncluded = transportSurcharge <= 0
  const transportCost = !transportIncluded && needsTransport === true ? transportSurcharge : 0
  // Gate the ride opt-in on assigned-car seats. Fail open while loading (null).
  // A diver editing a booking that already holds a ride keeps the option.
  const rideAllowed = rideSeats == null
    ? true
    : canRequestRide({
      capacity: rideSeats.capacity,
      claimed: rideSeats.claimed,
      alreadyHasRide: initialDetails?.transportation === true,
    })
  // The diver opted into a ride with no free seat left → a ride-waitlist
  // request. The booking still goes through; the shop is notified to add a car.
  const rideWaitlisted = needsTransport === true && !rideAllowed
  const subTotal = base + gearCost + roomCost + addonsCost + transportCost + ((showNitroxAddon && addNitroxCourse) ? NITROX_COURSE_FEE : 0)

  // The card/PayPal surcharge applies only to what actually goes on the card
  // *now*: the deposit when the diver pays deposit-only, otherwise the whole
  // subtotal. Charging 5% of the full amount when only the deposit is on the
  // card over-charges — the remainder is paid later, off the card.
  const depositFace = hasDeposit ? Math.min(event.deposit_amount ?? 0, subTotal) : 0
  const payingDepositOnly = hasDeposit && payDepositOnly
  const fullSurcharge    = Math.round(subTotal * paymentSurcharge)
  const depositSurcharge = Math.round(depositFace * paymentSurcharge)
  const total = subTotal + (payingDepositOnly ? depositSurcharge : fullSurcharge)
  // "How much to pay now" figures for each option:
  const fullNow        = subTotal + fullSurcharge            // pay full now (surcharge on everything)
  const depositNow     = depositFace + depositSurcharge      // pay deposit now (surcharge on the deposit only)
  const remainderLater = Math.max(0, subTotal - depositFace) // balance due later, no card surcharge

  // Every diver in a single-event family submit gets the same booking details,
  // so each booking's total is identical — the lead owes the per-diver figure
  // times the number of divers. Surface that cumulative figure when the lead
  // pays for the group; otherwise each diver is billed their own amount and the
  // per-diver figures stand alone.
  const groupCount       = 1 + additionalTargets.length
  const showGroupTotals  = leadPays && groupCount > 1
  const groupTotal       = total * groupCount
  const groupFullNow     = fullNow * groupCount
  const groupDepositNow  = depositNow * groupCount
  const groupRemainder   = remainderLater * groupCount

  // Account credit the diver applies at checkout (solo path only — the group
  // toggle above and the credit toggle are mutually exclusive). It pays the
  // booking down deposit-first, so it trims what's owed now and the leftover
  // balance. When the toggle is off (or no credit) these fall back to the gross
  // figures, so the same expressions render both cases.
  const creditNow            = creditEligible && useAccountCredit ? availableCredit : 0
  const creditDeducted       = Math.min(creditNow, total)
  const totalAfterCredit     = Math.max(0, total - creditNow)
  const fullNowAfterCredit   = Math.max(0, fullNow - creditNow)
  const depositNowAfterCredit = Math.max(0, depositNow - creditNow)
  const remainderAfterCredit = Math.max(0, remainderLater - Math.max(0, creditNow - depositNow))

  // Itemized breakdown of every charge that makes up `total`. Drives both the
  // on-screen summary and the snapshot written into details.charges, so what
  // the diver sees is exactly what gets frozen onto the booking.
  const charges = useMemo(() => {
    const room = (showRooms && roomId) ? rooms.find(r => r.id === roomId) ?? null : null
    return buildCharges({
      base,
      gear: (showGearRentChoice && gearChoice === 'rent')
        ? gearItems.map(item => ({ item, amount: (GEAR_ALACARTE_PRICES[item] ?? 0) * diveDays }))
        : [],
      gearDays: diveDays,
      room: room ? { label: room.display_title ?? room.admin_title ?? 'Room', amount: roomCost } : null,
      addons: showAddons
        ? [...addonIds].map(id => {
            const a = addons.find(x => x.id === id)
            return { label: a?.display_title ?? a?.admin_title ?? id, amount: a?.price ?? 0 }
          })
        : [],
      transport: transportCost,
      nitroxCourse: (showNitroxAddon && addNitroxCourse) ? NITROX_COURSE_FEE : 0,
      surcharge: paymentSurcharge > 0
        ? { label: t.chargeLines.surcharge(siteConfig.business.cardSurchargePercent, payingDepositOnly), amount: total - subTotal }
        : null,
    })
  }, [base, showGearRentChoice, gearChoice, gearItems, diveDays, showRooms, roomId, rooms, roomCost,
      showAddons, addonIds, addons, transportCost, showNitroxAddon, addNitroxCourse,
      paymentSurcharge, payingDepositOnly, total, subTotal])

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
    // On-behalf-of submissions skip uploads entirely — the caller may
    // lack storage RLS access to the target's folder (parents don't have
    // it; admins do but use AdminUsersPage). Target diver uploads later.
    let nitroxCardPath: string | null | undefined = undefined
    if (nitroxCertified && nitroxFile && userId && !isOnBehalfOf) {
      try {
        nitroxCardPath = await uploadNitroxCard(userId, nitroxFile)
      } catch (e) {
        setSaving(false)
        setErr(t.register.errors.uploadNitrox(e instanceof Error ? e.message : t.register.errors.unknownError))
        return
      }
    }
    let deepCardPath: string | null | undefined = undefined
    if (deepCertified && deepFile && userId && !isOnBehalfOf) {
      try {
        deepCardPath = await uploadDeepCard(userId, deepFile)
      } catch (e) {
        setSaving(false)
        setErr(t.register.errors.uploadDeep(e instanceof Error ? e.message : t.register.errors.unknownError))
        return
      }
    }
    let certCardPath: string | null | undefined = undefined
    if (certFile && userId && !isOnBehalfOf) {
      try {
        certCardPath = await uploadCertCard(userId, certFile)
      } catch (e) {
        setSaving(false)
        setErr(t.register.errors.uploadCert(e instanceof Error ? e.message : t.register.errors.unknownError))
        return
      }
    }

    const nullish = (v: string) => v.trim() === '' ? null : v.trim()
    // Sizes entered for gear rental fall back to whatever's already on file.
    const resolvedHeight = heightCm.trim() === '' ? (profile?.height_cm ?? null) : Number(heightCm)
    const resolvedWeight = weightKg.trim() === '' ? (profile?.weight_kg ?? null) : Number(weightKg)
    const resolvedShoe = shoeSize.trim() === '' ? (profile?.shoe_size ?? null) : shoeSize.trim()
    const profilePatch: ProfileUpdate = {
      name:               nullish(fullName),
      height_cm:               resolvedHeight,
      weight_kg:               resolvedWeight,
      shoe_size:               resolvedShoe,
      nickname:                nullish(nickname),
      date_of_birth:           nullish(dob),
      nationality:             nullish(nationality),
      gender:                  nullish(gender),
      id_number:               nullish(idNumber),
      contact_method:          (contactMethod || null) as ContactMethod | null,
      contact_id:              nullish(contactId),
      cert_agency:             uncertified ? null : nullish(certAgency),
      cert_level:              uncertified ? null : nullish(certLevel),
      uncertified,
      logged_dives:            Number.isFinite(loggedDives) ? loggedDives : 0,
      nitrox_certified:        nitroxCertified,
      ...(nitroxCardPath !== undefined ? { nitrox_card_path: nitroxCardPath } : {}),
      deep_certified:          deepCertified,
      ...(deepCardPath !== undefined ? { deep_card_path: deepCardPath } : {}),
      ...(certCardPath !== undefined ? { cert_card_path: certCardPath } : {}),
      emergency_contact_name:  nullish(emergencyName),
      emergency_contact_phone: nullish(emergencyPhone),
    }

    const details: BookingDetails = {
      gear: gearIncluded
        ? { rent: false, included: true }
        : !showGearRentChoice
          ? { rent: false }
          : gearChoice === 'rent'
            ? {
                rent: true,
                mode: 'a-la-carte',
                items: gearItems,
                size_overrides: {
                  height_cm: resolvedHeight,
                  weight_kg: resolvedWeight,
                  shoe_size: resolvedShoe,
                },
              }
            : gearChoice === 'help'
              ? { rent: false, assistance_note: gearHelpNote.trim() || 'Diver is unsure what gear they need and asked for help.' }
              : { rent: false },
      room: (showRooms && roomId) ? { option_id: roomId, notes: roomNotes || null } : undefined,
      add_ons: showAddons ? [...addonIds] : [],
      transportation: needsTransport === true,
      ride_waitlisted: rideWaitlisted,
      payment_method: payment,
      credit_card_invoice_email: payment === 'credit_card' && creditCardInvoiceEmail.trim()
        ? creditCardInvoiceEmail.trim()
        : undefined,
      pay_deposit_only: hasDeposit ? payDepositOnly : false,
      nitrox_course_addon: showNitroxAddon && addNitroxCourse,
      charges,
      total,
      // Surcharge-inclusive when paying by card/PayPal — the actual amount due
      // to secure the spot. Equals the face deposit for bank transfer / cash.
      deposit: hasDeposit ? depositNow : undefined,
      // Stamp the ack only when there's a policy and the diver ticked the
      // box — preserving any prior ack on the existing booking otherwise.
      cancellation_policy_acked_at: cancelPolicy && policyAcked
        ? (initialDetails?.cancellation_policy_acked_at ?? new Date().toISOString())
        : initialDetails?.cancellation_policy_acked_at,
      // Diver deferred the cert photo and accepted the bring-your-card terms.
      cert_card_ack_at: (needsCertPhoto && certCardAck)
        ? new Date().toISOString()
        : initialDetails?.cert_card_ack_at,
      // Diver acknowledged an event prerequisite they don't currently meet.
      prereq_acked_at: (prereqMismatch && prereqAck)
        ? new Date().toISOString()
        : initialDetails?.prereq_acked_at,
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

    // When more than one diver was picked we link the bookings with a
    // shared group_id (matches the MultiRegisterForm pattern). Single-
    // diver submits leave it unset so the column stays NULL.
    const groupId = additionalTargets.length > 0 ? crypto.randomUUID() : undefined

    // New booking — both guest and authed routes go through the
    // create-registration edge function so account/profile/booking/email
    // happen atomically server-side. The function handles the guest case
    // (creates the account with email_confirm: true) when email/password
    // are provided; authed callers' Bearer JWT identifies the user.
    // When actingOnBehalfOf is set, the caller (admin or parent) JWT is
    // used to authorise, but the booking lands on target_user_id.
    const { data, error } = await invokeWithRetry<{ booking_id: string; status?: string; session: { access_token: string; refresh_token: string } | null }>(
      'create-registration',
      {
        body: {
          ...(isGuest ? {
            email:    guestEmail.trim(),
            password: guestPassword,
            agreed_to_terms_at:      new Date().toISOString(),
            agreed_to_terms_version: CURRENT_TERMS_VERSION,
            turnstile_token:         turnstileToken ?? '',
          } : {}),
          ...(actingOnBehalfOf ? { target_user_id: actingOnBehalfOf } : {}),
          event_type:    event.type,
          event_id:      event.id,
          profile_patch: profilePatch,
          details,
          notes:         notes || null,
          ...(groupId ? { group_id: groupId, suppress_email: true } : {}),
          ...(leadPays && leadPayerId ? { payer_id: leadPayerId } : {}),
        },
      },
    )
    if (error) {
      const msg = await readFunctionsError(error, isGuest)
      // Lost-response recovery: a retried request may have actually landed the
      // first time, so the server now reports a duplicate. For a diver booking
      // themselves we can confirm by reading the booking back and treating it
      // as success rather than a scary error. (Guests fall through to the
      // existing "already registered → sign in" hint.)
      if (!isGuest && !actingOnBehalfOf && userId && /already .*active booking|already registered/i.test(msg)) {
        const recovered = await fetchOwnBooking(userId, event)
        if (recovered) {
          if (draftKey) clearRegistrationDraft(draftKey)
          setSaving(false)
          const result = { id: recovered.id, status: recovered.status }
          if (inlineConfirmation) setDoneInline(result); else onSubmitSuccess(result)
          return
        }
      }
      setSaving(false); setErr(msg); return
    }
    if (!data?.booking_id) { setSaving(false); setErr(t.register.errors.registrationFailed); return }

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
      const needGuestUpload = (nitroxCertified && nitroxFile) || (deepCertified && deepFile) || certFile
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
          if (deepCertified && deepFile) {
            try {
              const newPath = await uploadDeepCard(newUserId, deepFile)
              await supabase.from('profiles').update({ deep_card_path: newPath }).eq('id', newUserId)
            } catch (e) {
              console.error('deep card upload failed after signup:', e)
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
    // Fan out one create-registration per additional diver picked. Same
    // group_id, same details/notes, empty profile_patch (the parent's
    // typed-in values were already applied to themselves; child profiles
    // stay untouched). Promise.allSettled so a single child failure
    // doesn't blow away the others.
    let allOk = true
    if (additionalTargets.length > 0) {
      const calls = additionalTargets.map(async (target) => {
        const { data: d, error: e } = await invokeWithRetry<{ booking_id: string; status?: string }>(
          'create-registration',
          {
            body: {
              target_user_id: target.id,
              event_type:     event.type,
              event_id:       event.id,
              profile_patch:  {},
              details,
              notes:          notes || null,
              ...(groupId ? { group_id: groupId, suppress_email: true } : {}),
              ...(leadPays && leadPayerId ? { payer_id: leadPayerId } : {}),
            },
          },
        )
        if (e) throw new Error(await readFunctionsError(e, false))
        if (!d?.booking_id) throw new Error(t.register.errors.registrationFailedShort)
        return d
      })
      const settled = await Promise.allSettled(calls)
      const results = settled.map((res, i) => ({
        targetName: personName(additionalTargets[i].name, additionalTargets[i].nickname) || t.register.results.diverFallback,
        ok:    res.status === 'fulfilled',
        error: res.status === 'rejected'
          ? (res.reason instanceof Error ? res.reason.message : String(res.reason))
          : undefined,
      }))
      setAdditionalResults(results)
      allOk = results.every(r => r.ok)
    }

    // Every booking in the group suppressed its own confirmation email; send
    // one consolidated group summary instead. Best-effort — the bookings
    // already succeeded, so a summary hiccup shouldn't fail the registration.
    if (groupId && allOk) {
      try {
        await supabase.functions.invoke('send-group-summary', { body: { group_id: groupId } })
      } catch (e) {
        console.error('group summary email failed:', e)
      }
    }

    // Spend the diver's account credit against the brand-new booking when they
    // opted in. Best-effort: the booking already succeeded, so a credit hiccup
    // shouldn't fail registration — the diver can still apply it from Payments.
    if (creditEligible && useAccountCredit && availableCredit > 0 && data.booking_id) {
      try {
        setCreditApplied(await applyCreditToBooking({ bookingId: data.booking_id, amount: availableCredit }))
      } catch (e) {
        console.error('account credit apply failed:', e)
      }
    }

    setSaving(false)
    if (!allOk) { setErr(t.register.errors.someDiversFailed); return }
    // Booking landed — the resume draft has served its purpose; drop it so a
    // return visit doesn't re-offer a stale in-progress form.
    if (draftKey) clearRegistrationDraft(draftKey)
    // Pass status through so the parent can render a different success
    // toast when the booking landed as 'waitlisted' rather than 'pending'.
    const result = { id: data.booking_id, status: data.status ?? 'pending' }
    // Diver-facing modal: park the result and show "What happens next" inside
    // the modal, handing back to the parent only when the diver taps Done.
    if (inlineConfirmation) setDoneInline(result)
    else onSubmitSuccess(result)
  }

  // Terminal "What happens next" view — modal flow only. Replaces the form
  // once the booking lands; Done hands control back to the parent (which
  // closes the modal and refreshes its bookings).
  if (doneInline) {
    const waitlisted = doneInline.status === 'waitlisted'
    return (
      <div className="space-y-4">
        <header className="space-y-1">
          <h1 className="text-xl font-bold text-brand-900 leading-tight">
            {waitlisted ? t.register.done.waitlistTitle : t.register.done.submittedTitle}
          </h1>
          <p className="text-xs text-brand-900 font-medium">
            {event.title} · {formatEventSpan(event, { style: 'long' })}
          </p>
        </header>
        {creditApplied > 0 && (
          <p className="text-sm font-semibold text-emerald-800 bg-emerald-50 border border-emerald-400 rounded-lg p-3">
            {t.register.done.creditApplied(event.currency, creditApplied.toLocaleString())}
          </p>
        )}
        <WhatHappensNext waitlisted={waitlisted} />
        <div className="flex justify-end">
          <button
            onClick={() => onSubmitSuccess(doneInline)}
            className="bg-brand-900 hover:bg-brand-950 text-white text-sm font-semibold py-2 px-5 rounded-lg"
          >
            {t.register.done.done}
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold text-brand-900 leading-tight">{event.title}</h1>
          {onCancel && (
            <button onClick={onCancel} className="text-brand-900 font-medium text-xl leading-none shrink-0">×</button>
          )}
        </div>
        <p className="text-xs text-brand-900 font-medium">{formatEventSpan(event, { style: 'long' })}</p>
        <p className="text-xs text-brand-900 font-medium">{t.register.stepOf(step)}</p>
        {pickerHeader && (
          <div className="flex items-center justify-between gap-2 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1">
            <span className="text-xs text-brand-900 font-semibold">
              {t.register.header.bookingFor(pickerHeader.targetName)}
            </span>
            <button
              type="button"
              onClick={pickerHeader.onChange}
              className="text-xs text-brand-700 hover:underline font-semibold"
            >
              {t.register.header.change}
            </button>
          </div>
        )}
      </header>

      {showResumeBanner && savedDraft && (
        <div className="bg-accent/15 border border-accent rounded-lg p-3 space-y-2">
          <p className="text-sm text-brand-900 font-semibold">{t.register.resume.title}</p>
          <p className="text-xs text-brand-900">
            {t.register.resume.body}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => applyDraft(savedDraft)}
              className="bg-brand-900 hover:bg-brand-950 text-white text-xs font-semibold py-1.5 px-3 rounded-lg"
            >
              {t.register.resume.resume}
            </button>
            <button
              type="button"
              onClick={discardDraft}
              className="text-brand-700 hover:underline text-xs font-semibold py-1.5 px-2"
            >
              {t.register.resume.startFresh}
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <section className="space-y-3">
          {event.price != null && (
            <p className="text-sm text-brand-950 font-medium">{t.register.fromPrice(event.currency, event.price.toLocaleString())}</p>
          )}
          {pastBlocked && (
            <div role="alert" className="bg-red-50 border border-accent rounded-lg px-3 py-2 text-xs text-red-700">
              <p className="font-semibold">{t.register.past.title}</p>
              <p>{t.register.past.body}</p>
            </div>
          )}
          {/* Title carries the "(N spot(s) open)" / "(fully booked …)"
              suffix via the display_title trigger. We still show a fuller
              banner when the event is full so the diver understands the
              registration will land on the waitlist, not as confirmed. */}
          {eventIsFull(event) && (
            <div
              role="alert"
              className="bg-red-50 border border-accent rounded-lg px-3 py-2 text-xs text-red-700"
            >
              <p className="font-semibold">{t.register.full.title}</p>
              <p>{t.register.full.body}</p>
            </div>
          )}
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4">
          <h2 className="text-lg font-bold text-brand-900">{t.register.aboutYou}</h2>
          <p className="text-xs text-brand-900 font-medium">
            {t.register.step2.prefillHint}
          </p>

          {isGuest && (
            <div className="border border-surface-200 rounded-lg p-3 space-y-3 bg-surface-50">
              <div>
                <p className="text-sm font-semibold text-brand-900">{t.register.account.title}</p>
                <p className="text-xs text-brand-900 font-medium">
                  {t.register.account.body(siteConfig.identity.shortName)}
                </p>
              </div>
              <TextField label={t.register.account.emailLabel} type="email" value={guestEmail} onChange={setGuestEmail} required />
              <TextField label={t.register.account.passwordLabel} type="password" value={guestPassword} onChange={setGuestPassword} required />
              <label className="flex items-start gap-2 text-xs text-brand-950 font-medium">
                <input type="checkbox" checked={guestAgreedTerms} onChange={e => setGuestAgreedTerms(e.target.checked)} className="accent-brand-900 mt-0.5" />
                <span>
                  {t.register.account.agreePrefix}{' '}
                  <a href="/terms" target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">{t.register.account.termsLink}</a>.
                </span>
              </label>
              {turnstileSiteKey ? (
                <TurnstileWidget siteKey={turnstileSiteKey} onToken={setTurnstileToken} />
              ) : (
                <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                  {t.register.account.unavailable}
                </p>
              )}
            </div>
          )}

          <div className="space-y-3">
            <TextField
              label={t.register.step2.nameLabel}
              value={fullName}
              onChange={setFullName}
              required
              hint={t.register.step2.nameHint}
            />
            <TextField
              label={t.register.step2.nicknameLabel}
              value={nickname}
              onChange={setNickname}
              placeholder={t.register.step2.nicknamePlaceholder}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextField label={t.register.step2.dobLabel} type="date" value={dob} onChange={setDob} />
              <TextField label={t.register.nationalityRequired} value={nationality} onChange={setNationality} required />
            </div>
            <TextField label={t.register.step2.idLabel} value={idNumber} onChange={setIdNumber} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs text-brand-900 font-medium mb-1">{t.register.genderRequired}</span>
                <select
                  value={gender}
                  onChange={e => setGender(e.target.value)}
                  className="w-full bg-white border border-surface-300 rounded-lg px-2 py-2 text-sm text-brand-900"
                >
                  <option value="">—</option>
                  <option value="female">{t.register.genderFemale}</option>
                  <option value="male">{t.register.genderMale}</option>
                  <option value="other">{t.register.genderOther}</option>
                  <option value="prefer_not_to_say">{t.register.genderPreferNot}</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-xs text-brand-900 font-medium mb-1">{t.register.preferredContact}</span>
                <select
                  value={contactMethod}
                  onChange={e => setContactMethod(e.target.value as ContactMethod | '')}
                  className="w-full bg-white border border-surface-300 rounded-lg px-2 py-2 text-sm text-brand-900"
                >
                  <option value="">—</option>
                  <option value="line">LINE</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="phone">{t.register.contactPhone}</option>
                  <option value="email">{t.register.contactEmail}</option>
                </select>
              </label>
            </div>
            {contactMethod && (
              <TextField label={contactMethod === 'email' ? t.register.contactEmail : t.register.contactIdNumber} value={contactId} onChange={setContactId} />
            )}

            <div className="border-t border-surface-200 pt-3 space-y-3">
              <p className="text-xs text-brand-900 font-medium uppercase tracking-wider">{t.register.diving}</p>
              {!isOnBehalfOf && (
                <label className="flex items-center gap-2 text-sm text-brand-950 font-medium">
                  <input
                    type="checkbox"
                    checked={uncertified}
                    onChange={e => {
                      const v = e.target.checked
                      setUncertified(v)
                      if (v) { setCertAgency(''); setCertLevel(''); setCertFile(null); setCertCardAck(false) }
                    }}
                    className="accent-brand-900"
                  />
                  {t.register.notCertified}
                </label>
              )}
              {!uncertified && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <TextField label={t.register.certAgency} placeholder={t.register.certAgencyPlaceholder} value={certAgency} onChange={setCertAgency} />
                    <TextField label={t.register.certLevel} placeholder={t.register.certLevelPlaceholder} value={certLevel} onChange={setCertLevel} />
                  </div>
                  {certDeclarationBlocked && (
                    <p className="text-xs text-red-700 font-medium">
                      {t.register.certDeclarationError}
                    </p>
                  )}
                </>
              )}
              {!uncertified && certLevel.trim() !== '' && !hasCertCardOnFile && !isOnBehalfOf && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-brand-900">
                    {t.register.cert.addProof}
                  </p>
                  <p className="text-xs text-brand-950 font-medium">
                    {t.register.cert.uploadHint(siteConfig.identity.shortName)}
                  </p>
                  <label className="block cursor-pointer bg-brand-900 hover:bg-brand-950 text-white text-sm font-semibold py-2 px-3 rounded-lg text-center">
                    <input
                      type="file"
                      accept="image/*,.heic,.heif"
                      aria-label={t.register.cert.uploadAria}
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0] ?? null
                        e.target.value = ''
                        setCertFileErr(null)
                        if (file && !file.type.startsWith('image/') && !isHeicFile(file)) {
                          setCertFileErr(t.register.errors.chooseImage)
                          return
                        }
                        setCertFile(file)
                        if (file) setCertCardAck(false)
                      }}
                    />
                    {certFile ? t.register.replacePhoto(certFile.name) : t.register.choosePhoto}
                  </label>
                  {certFileErr && <p className="text-xs text-red-700">{certFileErr}</p>}
                  {!certFile && (
                    <label className="flex items-start gap-2 text-xs text-brand-950 font-medium border-t border-amber-300 pt-2">
                      <input
                        type="checkbox"
                        checked={certCardAck}
                        onChange={e => setCertCardAck(e.target.checked)}
                        className="accent-brand-900 mt-0.5"
                      />
                      <span>
                        {t.register.cert.ack}
                      </span>
                    </label>
                  )}
                </div>
              )}
              {!uncertified && certLevel.trim() !== '' && hasCertCardOnFile && (
                <p className="text-xs text-brand-950 font-medium">
                  {t.register.cert.onFile}
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <TextField
                  label={t.register.loggedDives} type="number" min={0}
                  value={loggedDives === 0 ? '' : String(loggedDives)}
                  onChange={v => setLoggedDives(Number(v) || 0)}
                />
                <label className="flex items-center sm:items-end gap-2 text-sm text-brand-950 font-medium sm:pb-2">
                  <input type="checkbox" checked={nitroxCertified} onChange={e => setNitroxCertified(e.target.checked)} className="accent-brand-900" />
                  {t.register.nitroxCertified}
                </label>
                <label className="flex items-center sm:items-end gap-2 text-sm text-brand-950 font-medium sm:pb-2">
                  <input type="checkbox" checked={deepCertified} onChange={e => setDeepCertified(e.target.checked)} className="accent-brand-900" />
                  {t.register.deepCertified}
                </label>
              </div>
              {nitroxCertified && !hasNitroxCardOnFile && !isOnBehalfOf && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-brand-900">
                    {t.register.nitrox.uploadTitle}
                  </p>
                  <p className="text-xs text-brand-950 font-medium">
                    {t.register.nitrox.uploadHint(siteConfig.identity.shortName)}
                  </p>
                  <label className="block cursor-pointer bg-brand-900 hover:bg-brand-950 text-white text-sm font-semibold py-2 px-3 rounded-lg text-center">
                    <input
                      type="file"
                      accept="image/*,.heic,.heif"
                      aria-label={t.register.nitrox.uploadAria}
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0] ?? null
                        e.target.value = ''
                        setNitroxFileErr(null)
                        if (file && !file.type.startsWith('image/') && !isHeicFile(file)) {
                          setNitroxFileErr(t.register.errors.chooseImage)
                          return
                        }
                        setNitroxFile(file)
                      }}
                    />
                    {nitroxFile ? t.register.replacePhoto(nitroxFile.name) : t.register.choosePhoto}
                  </label>
                  {nitroxFileErr && <p className="text-xs text-red-700">{nitroxFileErr}</p>}
                </div>
              )}
              {nitroxCertified && hasNitroxCardOnFile && (
                <p className="text-xs text-brand-950 font-medium">
                  {t.register.nitrox.onFile}
                </p>
              )}
              {deepCertified && !hasDeepCardOnFile && !isOnBehalfOf && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-brand-900">
                    {t.register.deep.uploadTitle}
                  </p>
                  <p className="text-xs text-brand-950 font-medium">
                    {t.register.deep.uploadHint(siteConfig.identity.shortName)}
                  </p>
                  <label className="block cursor-pointer bg-brand-900 hover:bg-brand-950 text-white text-sm font-semibold py-2 px-3 rounded-lg text-center">
                    <input
                      type="file"
                      accept="image/*,.heic,.heif"
                      aria-label={t.register.deep.uploadAria}
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0] ?? null
                        e.target.value = ''
                        setDeepFileErr(null)
                        if (file && !file.type.startsWith('image/') && !isHeicFile(file)) {
                          setDeepFileErr(t.register.errors.chooseImage)
                          return
                        }
                        setDeepFile(file)
                      }}
                    />
                    {deepFile ? t.register.replacePhoto(deepFile.name) : t.register.choosePhoto}
                  </label>
                  {deepFileErr && <p className="text-xs text-red-700">{deepFileErr}</p>}
                </div>
              )}
              {deepCertified && hasDeepCardOnFile && (
                <p className="text-xs text-brand-950 font-medium">
                  {t.register.deep.onFile}
                </p>
              )}
            </div>

            {prereqMismatch && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-brand-900">{t.register.prereq.title}</p>
                <ul className="text-xs text-brand-950 font-medium list-disc pl-4 space-y-0.5">
                  {prereqCertMismatch && <li>{t.register.prereq.certMismatch(prereqCertName ?? '')}</li>}
                  {prereqDivesMismatch && <li>{t.register.prereq.divesMismatch(prereqReqDives ?? 0, loggedDives)}</li>}
                </ul>
                <label className="flex items-start gap-2 text-xs text-brand-950 font-medium border-t border-amber-300 pt-2">
                  <input
                    type="checkbox"
                    checked={prereqAck}
                    onChange={e => setPrereqAck(e.target.checked)}
                    className="accent-brand-900 mt-0.5"
                  />
                  <span>
                    {t.register.prereq.ack(siteConfig.identity.shortName)}
                  </span>
                </label>
              </div>
            )}

            <div className="border-t border-surface-200 pt-3 space-y-3">
              <p className="text-xs text-brand-900 font-medium uppercase tracking-wider">{t.register.emergencyContact}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextField label={t.register.emergencyName} value={emergencyName} onChange={setEmergencyName} />
                <TextField label={t.register.emergencyPhone} type="tel" value={emergencyPhone} onChange={setEmergencyPhone} />
              </div>
            </div>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4">
          <h2 className="text-lg font-bold text-brand-900">{t.register.extras.title}</h2>

          {!gearIncluded && !showGearRentChoice && !showRooms && !showAddons && !showNitroxAddon && (
            <p className="text-brand-900 font-medium text-sm">{t.register.extras.none}</p>
          )}

          {gearIncluded && (
            <p className="text-sm text-brand-950 font-medium">
              {t.register.gear.includedNote}
            </p>
          )}

          {showGearRentChoice && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-brand-900">{t.register.gear.title}</p>
              <p className="text-xs text-brand-950 font-medium">
                {t.register.gear.blurb}
              </p>
              {event.gear_rental_info && (
                <p className="text-xs text-brand-950 font-medium">{event.gear_rental_info}</p>
              )}
              <div className="space-y-1">
                <label className="flex items-start gap-2 text-sm text-brand-950 font-medium">
                  <input type="radio" name="gear-choice" checked={gearChoice === 'none'} onChange={() => setGearChoice('none')} className="accent-brand-900 mt-1" />
                  <span className="flex-1">{t.register.gear.optNone}</span>
                </label>
                <label className="flex items-start gap-2 text-sm text-brand-950 font-medium">
                  <input type="radio" name="gear-choice" checked={gearChoice === 'rent'} onChange={() => setGearChoice('rent')} className="accent-brand-900 mt-1" />
                  <span className="flex-1">{t.register.gear.optRent}</span>
                </label>
                <label className="flex items-start gap-2 text-sm text-brand-950 font-medium">
                  <input type="radio" name="gear-choice" checked={gearChoice === 'help'} onChange={() => setGearChoice('help')} className="accent-brand-900 mt-1" />
                  <span className="flex-1">{t.register.gear.optHelp}</span>
                </label>
              </div>
              {gearChoice === 'rent' && (
                <div className="pl-6 space-y-2">
                  <p className="text-xs text-brand-950 font-medium">{t.register.checkItems}</p>
                  <div className="grid grid-cols-2 gap-1">
                    {GEAR_ITEMS.map(item => (
                      <label key={item} className="flex items-center gap-1 text-xs text-brand-950 font-medium">
                        <input type="checkbox" checked={gearItems.includes(item)} onChange={() => toggleItem(item)} className="accent-brand-900" />
                        {item} ({GEAR_ALACARTE_PRICES[item]})
                      </label>
                    ))}
                  </div>

                  {(askShoe || askHeight || askWeight) && (
                    <div className="border-t border-surface-200 pt-2 space-y-2">
                      <p className="text-xs font-semibold text-brand-900">
                        {t.register.gear.sizesTitle}
                        <span className="text-red-600"> *</span>
                      </p>
                      {askHeight && (
                        <label className="block text-xs text-brand-950 font-medium">
                          {t.register.gear.heightCm}
                          <input
                            type="number" min="1" step="0.1" inputMode="decimal"
                            value={heightCm}
                            onChange={e => setHeightCm(e.target.value)}
                            className="mt-0.5 w-full bg-white border border-surface-300 rounded-lg px-2 py-1 text-sm text-brand-900"
                          />
                        </label>
                      )}
                      {askWeight && (
                        <label className="block text-xs text-brand-950 font-medium">
                          {t.register.gear.weightKg}
                          <input
                            type="number" min="1" step="0.1" inputMode="decimal"
                            value={weightKg}
                            onChange={e => setWeightKg(e.target.value)}
                            className="mt-0.5 w-full bg-white border border-surface-300 rounded-lg px-2 py-1 text-sm text-brand-900"
                          />
                        </label>
                      )}
                      {askShoe && (
                        <div className="text-xs text-brand-950 font-medium">
                          {t.register.gear.shoeSize}
                          <div className="mt-0.5">
                            <ShoeSizeField initial={profile?.shoe_size ?? null} onChange={setShoeSize} />
                          </div>
                        </div>
                      )}
                      <p className="text-[11px] text-brand-950/70 font-medium">{t.register.gear.savedForNext}</p>
                    </div>
                  )}
                </div>
              )}
              {gearChoice === 'help' && (
                <div className="pl-6 space-y-1">
                  <p className="text-xs text-brand-950 font-medium">
                    {t.register.gear.helpBlurb}
                  </p>
                  <textarea
                    value={gearHelpNote}
                    onChange={e => setGearHelpNote(e.target.value)}
                    rows={3}
                    placeholder={t.register.gear.helpPlaceholder}
                    className="w-full bg-white border border-surface-300 rounded-lg px-2 py-1 text-sm text-brand-900"
                  />
                </div>
              )}
            </div>
          )}

          {showRooms && rooms.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-brand-950 font-medium font-semibold">{t.register.room.title}</p>
              <p className="text-xs text-brand-950 font-medium">
                {t.register.room.blurb}
              </p>
              <select value={roomId} onChange={e => setRoomId(e.target.value)} className="w-full bg-white border border-surface-300 rounded-lg px-2 py-1 text-sm text-brand-900">
                <option value="">{t.register.room.keepIncluded}</option>
                {rooms.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.display_title ?? r.admin_title} {r.added_price != null && `(+${r.added_price.toLocaleString()})`}
                  </option>
                ))}
              </select>
              {roomId && (
                <input value={roomNotes} onChange={e => setRoomNotes(e.target.value)} placeholder={t.register.room.notesPlaceholder} className="w-full bg-white border border-surface-300 rounded-lg px-2 py-1 text-sm text-brand-900" />
              )}
            </div>
          )}

          {showAddons && addons.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-brand-950 font-medium font-semibold">{t.register.addons.title}</p>
              <div className="max-h-40 overflow-y-auto grid grid-cols-1 gap-1 pr-1">
                {addons.map(a => (
                  <label key={a.id} className="flex items-center gap-2 text-xs text-brand-950 font-medium">
                    <input type="checkbox" checked={addonIds.has(a.id)} onChange={() => toggleAddon(a.id)} className="accent-brand-900" />
                    <span className="flex-1">{a.display_title ?? a.admin_title}</span>
                    {a.price != null && <span className="text-brand-900 font-medium">+{a.price.toLocaleString()}</span>}
                  </label>
                ))}
              </div>
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-brand-900">{t.register.transport.legend}</legend>
            <label className="flex gap-2 text-sm font-medium items-start text-brand-950">
              <input type="radio" name="transport" checked={needsTransport === true} onChange={() => setNeedsTransport(true)} className="accent-brand-900 mt-1" />
              <span className="flex-1">
                <span className="block">{t.register.transport.yesSolo}</span>
                {!transportIncluded && transportSurcharge > 0 && (
                  <span className="block text-xs text-brand-950 font-medium">{t.register.transport.surcharge(transportSurcharge.toLocaleString(), event.currency)}</span>
                )}
                {transportIncluded && rideAllowed && (
                  <span className="block text-xs text-brand-950 font-medium">{t.register.transport.included}</span>
                )}
                {rideAllowed && rideSeats != null && rideSeats.capacity > 0 && (
                  <span className="block text-xs text-brand-950/70 font-medium">
                    {t.register.transport.seatsLeft(rideSeats.available)}
                  </span>
                )}
                {!rideAllowed && (
                  <span className={`block text-xs font-semibold ${rideWaitlisted ? 'text-amber-700' : 'text-brand-950/70'}`}>
                    {rideSeats != null && rideSeats.capacity > 0
                      ? t.register.transport.rideFullSolo
                      : t.register.transport.rideNotSetup}{' '}
                    {rideWaitlisted
                      ? t.register.transport.waitlistedSolo
                      : t.register.transport.selectToWaitlist}
                  </span>
                )}
              </span>
            </label>
            <label className="flex gap-2 text-sm text-brand-950 font-medium items-start">
              <input type="radio" name="transport" checked={needsTransport === false} onChange={() => setNeedsTransport(false)} className="accent-brand-900 mt-1" />
              <span className="flex-1">
                <span className="block">{t.register.transport.noSolo}</span>
                <span className="block text-xs text-brand-950 font-medium">
                  {t.register.transport.noSoloDetail}
                </span>
              </span>
            </label>
          </fieldset>

          {showNitroxAddon && (
            <label className="flex gap-2 text-sm text-brand-950 font-medium items-start">
              <input type="checkbox" checked={addNitroxCourse} onChange={e => setAddNitroxCourse(e.target.checked)} className="accent-brand-900 mt-1" />
              <span className="flex-1">
                <span className="block">{t.register.nitroxAddon.label(NITROX_COURSE_FEE.toLocaleString())}</span>
                <span className="block text-xs text-brand-950 font-medium">{t.register.nitroxAddon.detail}</span>
              </span>
            </label>
          )}

          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder={t.register.notesOptional}
            className="w-full bg-white border border-surface-300 rounded-lg px-2 py-1 text-sm text-brand-900" />
        </section>
      )}

      {step === 4 && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-brand-900">{t.register.payment.title}</h2>

          {leadPayerId && (
            <label className="flex items-start gap-2 text-sm text-brand-950 font-medium bg-surface-50 border border-surface-200 rounded-lg p-3">
              <input
                type="checkbox"
                checked={payForEveryone}
                onChange={e => setPayForEveryone(e.target.checked)}
                className="accent-brand-900 mt-1"
              />
              <span className="flex-1">
                {t.register.payment.payForEveryone}
                <span className="block text-xs text-brand-900/80">
                  {t.register.payment.payForEveryoneDetail}
                </span>
              </span>
            </label>
          )}

          <div className="space-y-2">
            {(['bank_transfer', 'paypal', 'credit_card', 'cash'] as const).map(method => (
              <label key={method} className="flex gap-2 text-sm text-brand-950 font-medium items-start">
                <input type="radio" name="payment" checked={payment === method} onChange={() => setPayment(method)} className="accent-brand-900 mt-1" />
                <span className="flex-1">
                  <span className="block">
                    {method === 'bank_transfer' && t.register.payment.methodBankTransfer}
                    {method === 'paypal' && t.register.payment.methodPaypal(siteConfig.business.cardSurchargePercent)}
                    {method === 'credit_card' && t.register.payment.methodCreditCard(siteConfig.business.cardSurchargePercent)}
                    {method === 'cash' && t.register.payment.methodCash}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {payment === 'credit_card' && (
            <label className="block">
              <span className="block text-xs text-brand-900 font-medium mb-1">
                {t.register.payment.invoiceEmailLabel}
              </span>
              <input
                type="email"
                value={creditCardInvoiceEmail}
                onChange={e => setCreditCardInvoiceEmail(e.target.value)}
                placeholder={t.register.payment.invoiceEmailPlaceholder}
                className="w-full bg-white border border-surface-300 rounded-lg px-3 py-2 text-sm text-brand-900"
              />
            </label>
          )}

          <PaymentInstructionsBlock
            method={payment}
            invoiceEmail={payment === 'credit_card' ? creditCardInvoiceEmail.trim() || null : null}
          />

          <div className="text-sm text-brand-950 font-medium bg-surface-50 rounded-lg p-3 space-y-1">
            {charges.map((c, i) => <Row key={`${c.kind}-${i}`} label={c.label} value={c.amount} currency={event.currency} />)}
            <div className="border-t border-surface-200 pt-1 mt-1">
              <Row label={showGroupTotals ? t.register.payment.perDiver : t.register.payment.total} value={total} currency={event.currency} bold />
            </div>
            {creditNow > 0 && (
              <div className="border-t border-surface-200 pt-1 mt-1 space-y-0.5">
                <div className="flex justify-between text-emerald-700">
                  <span>{t.register.payment.accountCredit}</span>
                  <span>{t.register.payment.minus(event.currency, creditDeducted.toLocaleString())}</span>
                </div>
                <Row label={t.register.payment.youllPayAfterCredit} value={totalAfterCredit} currency={event.currency} bold />
              </div>
            )}
            {showGroupTotals && (
              <div className="border-t border-surface-200 pt-1 mt-1 space-y-0.5">
                <Row label={t.register.payment.groupTotal(groupCount)} value={groupTotal} currency={event.currency} bold />
                <p className="text-xs text-brand-900/80">{t.register.payment.groupSharing}</p>
              </div>
            )}
          </div>

          {creditEligible && availableCredit > 0 && (
            <label className="flex items-start gap-2 text-sm text-brand-950 font-medium bg-emerald-400/10 border border-emerald-400/40 rounded-lg p-3">
              <input
                type="checkbox"
                checked={useAccountCredit}
                onChange={e => setUseAccountCredit(e.target.checked)}
                className="accent-brand-900 mt-1"
              />
              <span className="flex-1">
                {t.register.payment.useCredit(event.currency, availableCredit.toLocaleString())}
                <span className="block text-xs text-brand-900/80">
                  {t.register.payment.useCreditDetail}
                </span>
              </span>
            </label>
          )}

          {hasDeposit && (
            <div className="space-y-2">
              <p className="text-sm text-brand-950 font-medium font-semibold">{t.register.payment.howMuchNow}</p>
              <label className="flex gap-2 text-sm text-brand-950 font-medium items-start">
                <input type="radio" name="pay-amount" checked={!payDepositOnly} onChange={() => setPayDepositOnly(false)} className="accent-brand-900 mt-1" />
                <span className="flex-1">
                  <span className="block">{t.register.payment.payFull}</span>
                  <span className="block text-xs text-brand-950 font-medium">
                    {event.currency} {(showGroupTotals ? groupFullNow : fullNowAfterCredit).toLocaleString()}
                    {showGroupTotals ? t.register.payment.settlesAll(groupCount) : t.register.payment.settlesOne}
                  </span>
                </span>
              </label>
              <label className="flex gap-2 text-sm text-brand-950 font-medium items-start">
                <input type="radio" name="pay-amount" checked={payDepositOnly} onChange={() => setPayDepositOnly(true)} className="accent-brand-900 mt-1" />
                <span className="flex-1">
                  <span className="block">{t.register.payment.payDepositOnly}</span>
                  <span className="block text-xs text-brand-950 font-medium">
                    {event.currency} {(showGroupTotals ? groupDepositNow : depositNowAfterCredit).toLocaleString()} {t.register.payment.remainderDueBeforeTrip}
                  </span>
                </span>
              </label>
            </div>
          )}

          <div className="text-xs text-brand-950 font-medium bg-surface-50 border border-surface-200 rounded-lg p-3 space-y-1">
            <p>
              {t.register.payment.payDepositAsap1} <strong>{t.register.payment.asap}</strong> {t.register.payment.payDepositAsap2} <strong>{formatDeadline(fullPaymentDeadline)}</strong> {t.register.payment.payDepositAsap3}
            </p>
            {hasDeposit && payDepositOnly && (
              <div className="border-t border-surface-200 pt-1 mt-1 space-y-0.5">
                <p>
                  {t.register.payment.payDepositAsap1} <strong>{t.register.payment.asap}</strong>:{' '}
                  <strong>{event.currency} {(showGroupTotals ? groupDepositNow : depositNowAfterCredit).toLocaleString()}</strong>
                  {showGroupTotals && t.register.payment.wholeGroup(groupCount)}
                </p>
                <p>
                  {t.register.payment.payRemainingBy} {formatDeadline(fullPaymentDeadline)}:{' '}
                  <strong>{event.currency} {(showGroupTotals ? groupRemainder : remainderAfterCredit).toLocaleString()}</strong>
                </p>
              </div>
            )}
          </div>

          {cancelPolicy && cancelPolicy.cancellation_policy && (
            <div className="text-xs text-brand-950 font-medium bg-white/70 border border-surface-300 rounded-lg p-3 space-y-2">
              <p className="font-semibold text-brand-900">
                {t.register.payment.cancellationPolicy}{cancelPolicy.title ? ` — ${cancelPolicy.title}` : ''}
              </p>
              {event.cancel_date && (
                <p>{t.register.payment.cancelByDate} <strong>{formatDeadline(event.cancel_date)}</strong></p>
              )}
              <p className="whitespace-pre-line max-h-40 overflow-y-auto pr-1">
                {cancelPolicy.cancellation_policy}
              </p>
              <label className="flex items-start gap-2 pt-1">
                <input
                  type="checkbox"
                  checked={policyAcked}
                  onChange={e => setPolicyAcked(e.target.checked)}
                  className="accent-brand-900 mt-0.5"
                />
                <span>{t.register.payment.policyAck}</span>
              </label>
            </div>
          )}

          {waiverEligible && missingW && missingW.length > 0 && (
            <div className="text-xs text-brand-950 font-medium bg-amber-400/10 border border-amber-400/40 rounded-lg p-3 space-y-2" aria-label={t.register.waivers.ariaOutstanding}>
              <p className="font-semibold text-amber-800">
                {t.register.waivers.toSignBefore(event.type)}
              </p>
              <p>{t.register.waivers.stillBookSolo}</p>
              <ul className="space-y-1">
                {missingW.map(w => (
                  <li key={w.code} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{w.title}</span>
                    <button
                      type="button"
                      onClick={() => setSigningW(w)}
                      className="shrink-0 px-2.5 py-1 rounded-lg bg-brand-900 hover:bg-brand-950 text-white text-xs font-semibold"
                    >
                      {t.register.waivers.signNow}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {additionalResults.length > 0 && (
            <div className="text-xs bg-surface-50 border border-surface-300 rounded p-2 space-y-1" aria-label={t.register.results.ariaPerDiver}>
              <p className="font-semibold text-brand-900">{t.register.results.additionalDivers}</p>
              {additionalResults.map((r, i) => (
                <p key={i} className={r.ok ? 'text-emerald-800' : 'text-red-700'}>
                  · {r.targetName}: {r.ok ? t.register.results.registered : t.register.results.failed(r.error ?? '')}
                </p>
              ))}
            </div>
          )}

          {err && <p className="text-red-600 text-sm">{err}</p>}
        </section>
      )}

      {saving && !isEdit && (
        <p className="text-xs text-brand-900 font-medium" role="status">
          {t.register.status.submitting}
        </p>
      )}

      <footer className="flex items-center justify-between gap-2 pt-2">
        <button
          onClick={() => {
            if (step === 1) onBackBeforeStepOne?.()
            else setStep((step - 1) as Step)
          }}
          disabled={step === 1 && !onBackBeforeStepOne}
          className="text-sm text-brand-900 font-medium hover:text-brand-900 disabled:opacity-40"
        >
          {t.register.back}
        </button>
        {step < 4 ? (
          <button
            onClick={() => setStep((step + 1) as Step)}
            disabled={
              pastBlocked ||
              (step === 2 && (
                (!isOnBehalfOf && fullName.trim() === '') ||
                profileFieldsBlocked ||
                certDeclarationBlocked ||
                certPhotoBlocked ||
                prereqBlocked ||
                (!isOnBehalfOf && nitroxBlocked) ||
                (!isOnBehalfOf && deepBlocked) ||
                (isGuest && (guestEmail.trim() === '' || guestPassword.length < 8 || !guestAgreedTerms || !turnstileToken))
              )) ||
              (step === 3 && !isOnBehalfOf && needsTransport === null) ||
              (step === 3 && !isOnBehalfOf && showGearRentChoice && gearChoice === null) ||
              (step === 3 && sizesBlocked)
            }
            className="bg-brand-900 hover:bg-brand-950 disabled:opacity-40 text-white text-sm font-semibold py-2 px-4 rounded-lg"
          >
            {t.register.next}
          </button>
        ) : (
          <button onClick={submit} disabled={saving || pastBlocked || sizesBlocked || (!isOnBehalfOf && !!cancelPolicy && !policyAcked)}
            className="bg-brand-900 hover:bg-brand-950 disabled:opacity-60 disabled:cursor-wait text-white text-sm font-semibold py-2 px-4 rounded-lg inline-flex items-center gap-2">
            {saving && (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
            )}
            {saving ? (isEdit ? t.register.buttons.saving : t.register.buttons.confirming) : isEdit ? t.register.buttons.saveChanges : t.register.buttons.confirmBooking}
          </button>
        )}
      </footer>

      {signingW && (
        <WaiverSignDialog
          def={signingW}
          event={eventRef}
          onSigned={() => { setSigningW(null); refreshMissingWaivers() }}
          onClose={() => setSigningW(null)}
        />
      )}
    </>
  )
}

function Row({ label, value, currency, bold = false }: { label: string; value: number; currency: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold text-brand-900' : ''}`}>
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
    <div className="text-xs text-brand-950 font-medium bg-white/70 border border-surface-200 rounded-lg p-3 space-y-1">
      <p className="font-semibold text-brand-900">{instr.title}</p>
      {instr.lines.map((line, i) => <PaymentInstructionLine key={i} line={line} />)}
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
        className="text-brand-700 underline break-all"
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
  label, value, onChange, type = 'text', required, placeholder, min, hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: 'text' | 'email' | 'tel' | 'number' | 'date' | 'password'
  required?: boolean
  placeholder?: string
  min?: number
  hint?: string
}) {
  return (
    <label className="block">
      <span className="block text-xs text-brand-900 font-medium mb-1">{label}</span>
      {type === 'date' ? (
        <DateField
          value={value}
          onChange={onChange}
          required={required}
          className="w-full bg-white border border-surface-300 rounded-lg px-2 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900"
        />
      ) : type === 'password' ? (
        <PasswordInput
          value={value}
          onChange={e => onChange(e.target.value)}
          required={required}
          placeholder={placeholder}
          className="w-full bg-white border border-surface-300 rounded-lg px-2 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          required={required}
          placeholder={placeholder}
          min={min}
          className="w-full bg-white border border-surface-300 rounded-lg px-2 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900"
        />
      )}
      {hint && <span className="block text-xs text-brand-900/70 mt-1">{hint}</span>}
    </label>
  )
}
