import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/errors'
import { siteConfig } from '../../config/site'
import type { CancellationPolicy, CertLevel, DiveTravelEntry, EOAddon, EOCourse, EODive, EOPrice, EORoom, TravelDestination } from '../../types/database'
import {
  EMPTY_FORM,
  formStateFromCourse,
  formStateFromDive,
  type FormState,
} from './event-form-state'
import { DateField } from '../DateField'
import { ERROR_NOTE } from '../../styles/tokens'

// Shared form for creating and editing an EO_dive / EO_course. Owns all
// field state, the lookup data (prices / rooms / addons / cert levels),
// and the inline price-tier sub-form. The parent (AdminNewEventPage,
// AdminEditEventPage) is responsible for the actual DB write + post-
// submit navigation; the form just hands back the validated FormState.

// Discriminated union so the picker can drive both the type pill and the
// row → form mapping from a single selection.
type PastEvent =
  | { kind: 'dive';   id: string; startDate: string; title: string; row: EODive }
  | { kind: 'course'; id: string; startDate: string; title: string; row: EOCourse }

const CUR = siteConfig.locale.currencyLabel

// "Standard (total: 5000 NTD / deposit: 1500 NTD)" — drops parts that
// aren't set so a tier with only one of the two prices doesn't render an
// awkward placeholder.
function priceOptionLabel(p: EOPrice): string {
  const parts: string[] = []
  if (p.starting_at != null)    parts.push(`total: ${p.starting_at} ${CUR}`)
  if (p.deposit_amount != null) parts.push(`deposit: ${p.deposit_amount} ${CUR}`)
  return parts.length ? `${p.admin_title} (${parts.join(' / ')})` : p.admin_title
}

// Sub-form state for creating a brand-new EO_prices row inline (so admins
// don't have to leave the form just to define a price tier).
interface PriceFormState {
  admin_title: string
  price: string             // human label, e.g. "NT$10,000"
  starting_at: string       // bigint or empty
  deposit_amount: string    // bigint or empty
  // Per-event room options now live solely on EO_dives.room_types — see
  // 20260430040000_eo_dive_rooms_junction.sql. EO_prices no longer carries
  // a room_options column.
  transport: string
}

const EMPTY_PRICE_FORM: PriceFormState = {
  admin_title: '', price: '', starting_at: '', deposit_amount: '', transport: '',
}

// Sub-form state for inline EO_rooms / Other_Addons / DiveTravel inserts.
// Only the most-used fields — admins can edit the rest from the Manage page.
interface RoomFormState   { admin_title: string; display_title: string; added_price: string }
interface AddonFormState  { admin_title: string; display_title: string; price: string }
interface TravelFormState { admin_title: string; included: string; not_included: string; transportation: string }

const EMPTY_ROOM_FORM:   RoomFormState   = { admin_title: '', display_title: '', added_price: '' }
const EMPTY_ADDON_FORM:  AddonFormState  = { admin_title: '', display_title: '', price: '' }
const EMPTY_TRAVEL_FORM: TravelFormState = { admin_title: '', included: '', not_included: '', transportation: '' }

export interface EventFormProps {
  mode: 'create' | 'edit'
  /** Required in edit mode; ignored in create mode. */
  initial?: FormState
  /** Called with the validated form state. Throw on failure to surface as inline error. */
  onSubmit: (form: FormState) => Promise<void>
  /** Where the cancel button navigates back to. */
  onCancel: () => void
  /** Override the submit button text (defaults to "Create dive/course" or "Save changes"). */
  submitLabel?: string
}

export function EventForm({ mode, initial, onSubmit, onCancel, submitLabel }: EventFormProps) {
  const [form, setForm] = useState<FormState>(initial ?? EMPTY_FORM)
  const [prices, setPrices] = useState<EOPrice[]>([])
  const [rooms, setRooms] = useState<EORoom[]>([])
  const [addons, setAddons] = useState<EOAddon[]>([])
  const [certLevels, setCertLevels] = useState<CertLevel[]>([])
  const [cancelPolicies, setCancelPolicies] = useState<CancellationPolicy[]>([])
  const [diveTravels, setDiveTravels] = useState<DiveTravelEntry[]>([])
  const [destinations, setDestinations] = useState<TravelDestination[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Past events for the preload picker, sorted most-recent-first.
  const [pastEvents, setPastEvents] = useState<PastEvent[]>([])
  const [preloadId, setPreloadId] = useState<string>('')
  // Inline-create sub-forms — all collapsed by default. Each can be opened
  // independently so admins can spin up new lookup rows without leaving
  // the event form. Optimistically prepend on success so the new row is
  // immediately pickable.
  const [showNewPrice, setShowNewPrice] = useState(false)
  const [priceForm, setPriceForm] = useState<PriceFormState>(EMPTY_PRICE_FORM)
  const [priceSubmitting, setPriceSubmitting] = useState(false)
  const [priceError, setPriceError] = useState<string | null>(null)

  const [showNewRoom, setShowNewRoom] = useState(false)
  const [roomForm, setRoomForm] = useState<RoomFormState>(EMPTY_ROOM_FORM)
  const [roomSubmitting, setRoomSubmitting] = useState(false)
  const [roomError, setRoomError] = useState<string | null>(null)

  const [showNewAddon, setShowNewAddon] = useState(false)
  const [addonForm, setAddonForm] = useState<AddonFormState>(EMPTY_ADDON_FORM)
  const [addonSubmitting, setAddonSubmitting] = useState(false)
  const [addonError, setAddonError] = useState<string | null>(null)

  const [showNewTravel, setShowNewTravel] = useState(false)
  const [travelForm, setTravelForm] = useState<TravelFormState>(EMPTY_TRAVEL_FORM)
  const [travelSubmitting, setTravelSubmitting] = useState(false)
  const [travelError, setTravelError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Past-event cutoff is local "today"; the date columns are text
      // YYYY-MM-DD so a string compare matches the calendar's view of
      // "today" without timezone drift.
      const today = new Date()
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

      // Skip the past-event lookup in edit mode — preloading from a
      // different past event would clobber the row being edited.
      const settled = await Promise.allSettled([
        supabase.from('EO_prices').select('*').order('admin_title'),
        supabase.from('EO_rooms').select('*').order('admin_title'),
        supabase.from('Other_Addons').select('*').order('admin_title'),
        mode === 'create'
          ? supabase.from('EO_dives').select('*').lt('start_date', todayStr).order('start_date', { ascending: false }).limit(50)
          : Promise.resolve({ data: [] as EODive[] }),
        // Courses have no scalar date column to filter/order on — fetch a
        // bounded set and narrow to "past" client-side via course_days.
        mode === 'create'
          ? supabase.from('EO_courses').select('*').limit(200)
          : Promise.resolve({ data: [] as EOCourse[] }),
        supabase.from('cert_levels').select('*').order('rank'),
        supabase.from('cancellation_policies').select('*').order('title'),
        supabase.from('DiveTravel').select('*').order('admin_title'),
        supabase.from('TravelDestinations').select('*').order('sort_order', { nullsFirst: false }),
      ])
      if (cancelled) return
      const dataOf = <T,>(i: number): T[] => {
        const r = settled[i]
        if (r.status !== 'fulfilled') return []
        const d = (r.value as { data?: T[] | null }).data
        return (d ?? []) as T[]
      }
      setPrices(dataOf<EOPrice>(0))
      setRooms(dataOf<EORoom>(1))
      setAddons(dataOf<EOAddon>(2))
      setCertLevels(dataOf<CertLevel>(5))
      setCancelPolicies(dataOf<CancellationPolicy>(6))
      setDiveTravels(dataOf<DiveTravelEntry>(7))
      setDestinations(dataOf<TravelDestination>(8))

      const pastDives = dataOf<EODive>(3).map<PastEvent>(d => ({
        kind: 'dive', id: d._id, startDate: d.start_date ?? '', title: d.display_title ?? d.admin_title ?? '(untitled dive)', row: d,
      }))
      const pastCourses = dataOf<EOCourse>(4)
        .map<PastEvent>(c => ({
          kind: 'course',
          id: c._id,
          startDate: [...(c.course_days ?? [])].filter(Boolean).sort()[0] ?? '',
          title: c.display_title ?? c.admin_title ?? '(untitled course)',
          row: c,
        }))
        .filter(c => c.startDate && c.startDate < todayStr)
      const merged = [...pastDives, ...pastCourses].sort((a, b) => b.startDate.localeCompare(a.startDate))
      setPastEvents(merged)
    })()
    return () => { cancelled = true }
  }, [mode])

  // Preloading from a past event — or editing a row imported with stale
  // reference ids — can leave a FK field (cert level / price tier /
  // cancellation policy) pointing at an option that no longer exists. The
  // <Select> can't render the missing option, so it silently reads as
  // "None" while the stale id lingers in form state, then the insert
  // fails with an opaque FK error. Drop any value that isn't in its
  // (loaded) option list so what the admin sees matches what gets saved.
  // Guarded on non-empty lists so a valid value isn't wiped before its
  // list has loaded.
  function sanitizeStaleRefs(f: FormState): FormState {
    const next = { ...f }
    if (certLevels.length && next.prereq_cert_id && !certLevels.some(c => c.id === next.prereq_cert_id)) next.prereq_cert_id = ''
    if (prices.length && next.price && !prices.some(p => p._id === next.price)) next.price = ''
    if (cancelPolicies.length && next.cancel_policy && !cancelPolicies.some(p => p._id === next.cancel_policy)) next.cancel_policy = ''
    return next
  }

  const filteredPastEvents = pastEvents.filter(p => p.kind === form.type)

  function applyPreload(p: PastEvent) {
    if (p.kind === 'dive') {
      setForm(formStateFromDive(p.row))
    } else {
      setForm(formStateFromCourse(p.row))
    }
  }

  function handlePreload(id: string) {
    setPreloadId(id)
    if (!id) return
    const found = pastEvents.find(p => p.id === id)
    if (found) applyPreload(found)
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function setCourseDay(index: number, value: string) {
    setForm(f => {
      const next = [...f.courseDays]
      next[index] = value
      return { ...f, courseDays: next }
    })
  }

  function addCourseDay() {
    setForm(f => (f.courseDays.length >= 4 ? f : { ...f, courseDays: [...f.courseDays, ''] }))
  }

  function removeCourseDay(index: number) {
    setForm(f => ({ ...f, courseDays: f.courseDays.filter((_, i) => i !== index) }))
  }

  function toggleId(key: 'addonIds' | 'roomIds' | 'destinationIds', id: string) {
    setForm(f => {
      const list = f[key]
      const next = list.includes(id) ? list.filter(x => x !== id) : [...list, id]
      return { ...f, [key]: next }
    })
  }

  async function submitNewPrice() {
    setPriceError(null)
    if (!priceForm.admin_title.trim()) {
      setPriceError('Title is required.')
      return
    }
    setPriceSubmitting(true)
    try {
      const id = crypto.randomUUID()
      const payload = {
        _id: id,
        admin_title: priceForm.admin_title.trim(),
        price: priceForm.price || null,
        starting_at: priceForm.starting_at ? Number(priceForm.starting_at) : null,
        deposit_amount: priceForm.deposit_amount ? Number(priceForm.deposit_amount) : null,
        transport: priceForm.transport ? Number(priceForm.transport) : null,
      }
      const { error: insErr } = await supabase.from('EO_prices').insert(payload as never)
      if (insErr) throw insErr
      // Optimistically inject so the user can pick the new tier immediately.
      const newRow = {
        ...payload,
        starting_at: payload.starting_at ?? null,
        deposit_amount: payload.deposit_amount ?? null,
      } as unknown as EOPrice
      setPrices(p => [...p, newRow].sort((a, b) => (a.admin_title ?? '').localeCompare(b.admin_title ?? '')))
      set('price', id)
      setPriceForm(EMPTY_PRICE_FORM)
      setShowNewPrice(false)
    } catch (err) {
      setPriceError(errorMessage(err))
    } finally {
      setPriceSubmitting(false)
    }
  }

  async function submitNewRoom() {
    setRoomError(null)
    if (!roomForm.admin_title.trim()) { setRoomError('Title is required.'); return }
    setRoomSubmitting(true)
    try {
      const id = crypto.randomUUID()
      const payload = {
        _id: id,
        admin_title: roomForm.admin_title.trim(),
        display_title: roomForm.display_title.trim() || null,
        added_price: roomForm.added_price ? Number(roomForm.added_price) : null,
      }
      const { error: insErr } = await supabase.from('EO_rooms').insert(payload as never)
      if (insErr) throw insErr
      setRooms(rs => [...rs, payload as unknown as EORoom].sort(
        (a, b) => (a.admin_title ?? a.display_title ?? '').localeCompare(b.admin_title ?? b.display_title ?? '')
      ))
      // Auto-tick the new room so admins don't have to scroll back.
      setForm(f => ({ ...f, has_rooms: true, roomIds: [...f.roomIds, id] }))
      setRoomForm(EMPTY_ROOM_FORM)
      setShowNewRoom(false)
    } catch (err) {
      setRoomError(errorMessage(err))
    } finally {
      setRoomSubmitting(false)
    }
  }

  async function submitNewAddon() {
    setAddonError(null)
    if (!addonForm.admin_title.trim()) { setAddonError('Title is required.'); return }
    setAddonSubmitting(true)
    try {
      const id = crypto.randomUUID()
      const payload = {
        _id: id,
        admin_title: addonForm.admin_title.trim(),
        display_title: addonForm.display_title.trim() || null,
        price: addonForm.price ? Number(addonForm.price) : null,
      }
      const { error: insErr } = await supabase.from('Other_Addons').insert(payload as never)
      if (insErr) throw insErr
      setAddons(as => [...as, payload as unknown as EOAddon].sort(
        (a, b) => (a.admin_title ?? a.display_title ?? '').localeCompare(b.admin_title ?? b.display_title ?? '')
      ))
      setForm(f => ({ ...f, addonIds: [...f.addonIds, id] }))
      setAddonForm(EMPTY_ADDON_FORM)
      setShowNewAddon(false)
    } catch (err) {
      setAddonError(errorMessage(err))
    } finally {
      setAddonSubmitting(false)
    }
  }

  async function submitNewTravel() {
    setTravelError(null)
    if (!travelForm.admin_title.trim()) { setTravelError('Title is required.'); return }
    setTravelSubmitting(true)
    try {
      const id = crypto.randomUUID()
      const payload = {
        _id: id,
        admin_title: travelForm.admin_title.trim(),
        included: travelForm.included || null,
        not_included: travelForm.not_included || null,
        transportation: travelForm.transportation || null,
      }
      const { error: insErr } = await supabase.from('DiveTravel').insert(payload as never)
      if (insErr) throw insErr
      setDiveTravels(ts => [...ts, payload as unknown as DiveTravelEntry].sort(
        (a, b) => (a.admin_title ?? '').localeCompare(b.admin_title ?? '')
      ))
      set('divetravel_reference', id)
      setTravelForm(EMPTY_TRAVEL_FORM)
      setShowNewTravel(false)
    } catch (err) {
      setTravelError(errorMessage(err))
    } finally {
      setTravelSubmitting(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Validate the per-type required fields up front.
    if (form.type === 'dive') {
      if (!form.admin_title.trim()) {
        setError('Admin title is required.')
        return
      }
      if (!form.start_date) {
        setError('Start date is required.')
        return
      }
    } else if (!form.courseDays.some(Boolean)) {
      setError('At least one course day is required.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit(sanitizeStaleRefs(form))
    } catch (err) {
      setError(errorMessage(err))
      setSubmitting(false)
    }
  }

  const defaultSubmitLabel = mode === 'create'
    ? `Create ${form.type === 'dive' ? 'dive' : 'course'}`
    : 'Save changes'

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* Type switch is create-only — switching dive↔course on an existing row
          would require migrating to the other table, which we don't support. */}
      {mode === 'create' && (
        <div className="flex gap-2">
          <TypePill active={form.type === 'dive'}   onClick={() => { set('type', 'dive');   setPreloadId('') }}>Dive</TypePill>
          <TypePill active={form.type === 'course'} onClick={() => { set('type', 'course'); setPreloadId('') }}>Course</TypePill>
        </div>
      )}

      {mode === 'create' && filteredPastEvents.length > 0 && (
        <div>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-white/80">
              Preload from past {form.type === 'dive' ? 'dive' : 'course'} (optional)
            </span>
            <select
              value={preloadId}
              onChange={e => handlePreload(e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">— Start fresh —</option>
              {filteredPastEvents.map(p => (
                <option key={p.id} value={p.id}>
                  {p.startDate || '????-??-??'} — {p.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <Section title="Basics">
        <Field label={form.type === 'dive' ? 'Admin title (required, internal)' : 'Admin title (internal)'}>
          <Input value={form.admin_title} onChange={v => set('admin_title', v)} required={form.type === 'dive'} />
        </Field>
        <Field label="Display title (diver-facing)">
          <Input value={form.display_title} onChange={v => set('display_title', v)} />
        </Field>
        <Field label="Calendar title (calendar widget; short)">
          <Input value={form.calendar_title} onChange={v => set('calendar_title', v)} />
        </Field>
        {form.type === 'dive' ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Start date">
              <Input type="date" value={form.start_date} onChange={v => set('start_date', v)} required />
            </Field>
            <Field label="Start time (24h)">
              <Input type="time" value={form.start_time} onChange={v => set('start_time', v)} />
            </Field>
            <Field label="End date">
              <Input type="date" value={form.end_date} onChange={v => set('end_date', v)} />
            </Field>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <span className="text-xs font-medium text-white/80">Course days (up to 4)</span>
              <p className="text-xs text-white/60">
                Enter each day the course runs on. Adjacent days show as one
                continuous bar on the calendar; gaps show as separate sessions.
              </p>
            </div>
            <div className="space-y-2">
              {form.courseDays.map((day, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input type="date" value={day} onChange={v => setCourseDay(i, v)} />
                  <button
                    type="button"
                    onClick={() => removeCourseDay(i)}
                    className="px-2 py-1 rounded-md text-xs font-medium text-white/80 hover:text-white border border-white/30"
                    aria-label={`Remove day ${i + 1}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            {form.courseDays.length < 4 && (
              <button
                type="button"
                onClick={addCourseDay}
                className="self-start text-xs font-medium text-amber-300 hover:text-amber-200"
              >
                + Add day
              </button>
            )}
            <Field label="Start time (24h)">
              <Input type="time" value={form.start_time} onChange={v => set('start_time', v)} />
            </Field>
          </div>
        )}
        <Field label="Price tier">
          <Select value={form.price} onChange={v => set('price', v)}>
            <option value="">— None —</option>
            {prices.map(p => (
              <option key={p._id} value={p._id}>{priceOptionLabel(p)}</option>
            ))}
          </Select>
        </Field>
        <button
          type="button"
          onClick={() => setShowNewPrice(s => !s)}
          className="-mt-2 self-start text-xs font-medium text-amber-300 hover:text-amber-200"
        >
          {showNewPrice ? '− Cancel new tier' : '+ New price tier'}
        </button>
        {showNewPrice && (
          <div className="space-y-3 rounded-lg border border-amber-300/40 bg-white/5 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-200">New price tier</h3>
            <Field label="Title (required)">
              <Input value={priceForm.admin_title} onChange={v => setPriceForm(f => ({ ...f, admin_title: v }))} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Price label">
                <Input value={priceForm.price} onChange={v => setPriceForm(f => ({ ...f, price: v }))} />
              </Field>
              <Field label="Starting at">
                <Input type="number" value={priceForm.starting_at} onChange={v => setPriceForm(f => ({ ...f, starting_at: v }))} />
              </Field>
              <Field label="Deposit amount">
                <Input type="number" value={priceForm.deposit_amount} onChange={v => setPriceForm(f => ({ ...f, deposit_amount: v }))} />
              </Field>
            </div>
            <Field label={`Transport (${CUR} per booking; blank or 0 = included in base)`}>
              <Input type="number" value={priceForm.transport} onChange={v => setPriceForm(f => ({ ...f, transport: v }))} />
            </Field>
            {priceError && (
              <p className={ERROR_NOTE}>{priceError}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitNewPrice}
                disabled={priceSubmitting}
                className="flex-1 py-2 rounded-lg text-sm font-semibold bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50 transition-colors"
              >
                {priceSubmitting ? 'Saving…' : 'Save price tier'}
              </button>
              <button
                type="button"
                onClick={() => { setShowNewPrice(false); setPriceForm(EMPTY_PRICE_FORM); setPriceError(null) }}
                className="px-3 py-2 rounded-lg text-sm font-medium text-white/80 hover:text-white border border-white/30"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Required dives">
            <Input value={form.req_dives} onChange={v => set('req_dives', v)} />
          </Field>
          <Field label="Dive days">
            <Input type="number" value={form.dive_days} onChange={v => set('dive_days', v)} />
          </Field>
          <Field label="Capacity">
            <Input type="number" value={form.capacity} onChange={v => set('capacity', v)} placeholder="Blank = no cap" />
          </Field>
        </div>
        <Field label="Required certification">
          <Select value={form.prereq_cert_id} onChange={v => set('prereq_cert_id', v)}>
            <option value="">— None —</option>
            {/* Prereqs are encoded as PADI ranks; agency-specific levels carry
                 a padi_equivalent_id so a CMAS 2-Star diver still satisfies a
                 PADI Rescue prereq when that comparison gets wired up. */}
            {certLevels.filter(c => c.organization === 'PADI').map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
      </Section>

      {form.type === 'dive' && (
        <>
          <Section title="Dive details">
            <Field label="Notes">
              <Textarea value={form.notes} onChange={v => set('notes', v)} />
            </Field>
            <div className="flex flex-wrap gap-3">
              <Checkbox checked={form.featured}        onChange={v => set('featured', v)}        label="Featured" />
              <Checkbox checked={form.fully_booked}    onChange={v => set('fully_booked', v)}    label="Fully booked" />
              <Checkbox checked={form.nitrox_required} onChange={v => set('nitrox_required', v)} label="Nitrox required" />
              <Checkbox checked={form.is_private}      onChange={v => set('is_private', v)}      label="Private (hidden from public calendars)" />
            </div>
            <Field label="Gear rental info">
              <Input value={form.gear_rental} onChange={v => set('gear_rental', v)} />
            </Field>
            <WixImageField
              label="Featured image (Wix URI)"
              value={form.featured_image}
              onChange={v => set('featured_image', v)}
            />
            <WixImageField
              label="Second image (Wix URI)"
              value={form.second_image}
              onChange={v => set('second_image', v)}
            />
            <div className="space-y-1">
              <span className="text-xs font-medium text-white/80">Destinations</span>
              {destinations.length === 0 ? (
                <p className="text-sm text-brand-950 font-medium">No destinations defined.</p>
              ) : (
                <div className="space-y-1 max-h-56 overflow-y-auto bg-white/70 backdrop-blur-md border border-surface-200 rounded-md p-2">
                  {destinations.map(d => (
                    <Checkbox
                      key={d._id}
                      checked={form.destinationIds.includes(d._id)}
                      onChange={() => toggleId('destinationIds', d._id)}
                      label={d.country ? `${d.admin_title ?? d._id} — ${d.country}` : (d.admin_title ?? d._id)}
                    />
                  ))}
                </div>
              )}
            </div>
            <Field label="DiveTravel reference">
              <Select value={form.divetravel_reference} onChange={v => set('divetravel_reference', v)}>
                <option value="">— None —</option>
                {diveTravels.map(t => (
                  <option key={t._id} value={t._id}>{t.admin_title ?? t._id}</option>
                ))}
              </Select>
            </Field>
            <button
              type="button"
              onClick={() => setShowNewTravel(s => !s)}
              className="-mt-2 self-start text-xs font-medium text-amber-300 hover:text-amber-200"
            >
              {showNewTravel ? '− Cancel new entry' : '+ New DiveTravel entry'}
            </button>
            {showNewTravel && (
              <div className="space-y-3 rounded-lg border border-amber-300/40 bg-white/5 p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-200">New DiveTravel entry</h3>
                <Field label="Title (required)">
                  <Input value={travelForm.admin_title} onChange={v => setTravelForm(f => ({ ...f, admin_title: v }))} />
                </Field>
                <Field label="Included">
                  <Textarea value={travelForm.included} onChange={v => setTravelForm(f => ({ ...f, included: v }))} />
                </Field>
                <Field label="Not included">
                  <Textarea value={travelForm.not_included} onChange={v => setTravelForm(f => ({ ...f, not_included: v }))} />
                </Field>
                <Field label="Transportation">
                  <Textarea value={travelForm.transportation} onChange={v => setTravelForm(f => ({ ...f, transportation: v }))} />
                </Field>
                {travelError && (
                  <p className={ERROR_NOTE}>{travelError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={submitNewTravel}
                    disabled={travelSubmitting}
                    className="flex-1 py-2 rounded-lg text-sm font-semibold bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50 transition-colors"
                  >
                    {travelSubmitting ? 'Saving…' : 'Save DiveTravel entry'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowNewTravel(false); setTravelForm(EMPTY_TRAVEL_FORM); setTravelError(null) }}
                    className="px-3 py-2 rounded-lg text-sm font-medium text-white/80 hover:text-white border border-white/30"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </Section>

          <Section title="Rooms">
            <Checkbox checked={form.has_rooms} onChange={v => set('has_rooms', v)} label="Offers rooms" />
            {form.has_rooms && rooms.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto bg-white/70 backdrop-blur-md border border-surface-200 rounded-md p-2">
                {rooms.map(r => (
                  <Checkbox
                    key={r._id}
                    checked={form.roomIds.includes(r._id)}
                    onChange={() => toggleId('roomIds', r._id)}
                    label={r.admin_title || r.display_title || r._id}
                  />
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowNewRoom(s => !s)}
              className="self-start text-xs font-medium text-amber-300 hover:text-amber-200"
            >
              {showNewRoom ? '− Cancel new room' : '+ New room option'}
            </button>
            {showNewRoom && (
              <div className="space-y-3 rounded-lg border border-amber-300/40 bg-white/5 p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-200">New room option</h3>
                <Field label="Title (required)">
                  <Input value={roomForm.admin_title} onChange={v => setRoomForm(f => ({ ...f, admin_title: v }))} />
                </Field>
                <Field label="Display name">
                  <Input value={roomForm.display_title} onChange={v => setRoomForm(f => ({ ...f, display_title: v }))} />
                </Field>
                <Field label={`Added price (${CUR})`}>
                  <Input type="number" value={roomForm.added_price} onChange={v => setRoomForm(f => ({ ...f, added_price: v }))} />
                </Field>
                {roomError && (
                  <p className={ERROR_NOTE}>{roomError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={submitNewRoom}
                    disabled={roomSubmitting}
                    className="flex-1 py-2 rounded-lg text-sm font-semibold bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50 transition-colors"
                  >
                    {roomSubmitting ? 'Saving…' : 'Save room option'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowNewRoom(false); setRoomForm(EMPTY_ROOM_FORM); setRoomError(null) }}
                    className="px-3 py-2 rounded-lg text-sm font-medium text-white/80 hover:text-white border border-white/30"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </Section>

        </>
      )}

      {form.type === 'course' && (
        <Section title="Course details">
          <Field label="Course name">
            <Input value={form.course_name} onChange={v => set('course_name', v)} />
          </Field>
          <Field label="Included">
            <Textarea value={form.included} onChange={v => set('included', v)} />
          </Field>
          <Field label="Schedule">
            <Textarea value={form.schedule} onChange={v => set('schedule', v)} />
          </Field>
          <WixImageField
            label="Featured image (Wix URI)"
            value={form.featured_image}
            onChange={v => set('featured_image', v)}
          />
        </Section>
      )}

      <Section title="Cancellation">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cancel-by date">
            <Input type="date" value={form.cancel_date} onChange={v => set('cancel_date', v)} />
          </Field>
          <Field label="Cancel policy">
            <Select value={form.cancel_policy} onChange={v => set('cancel_policy', v)}>
              <option value="">— None —</option>
              {cancelPolicies.map(p => (
                <option key={p._id} value={p._id}>{p.title ?? p._id}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Section>

      <Section title="Payment deadline">
        <p className="text-xs text-white/70">
          Shown to divers on the registration form and in the emailed PDF.
          Leave blank to fall back to "7 days before start date".
        </p>
        <Field label="Full payment deadline">
          <Input type="date" value={form.full_payment_deadline} onChange={v => set('full_payment_deadline', v)} />
        </Field>
      </Section>

      <Section title="Add-ons">
        {addons.length === 0 ? (
          <p className="text-sm text-brand-950 font-medium">No add-ons defined.</p>
        ) : (
          <div className="space-y-1 max-h-56 overflow-y-auto bg-white/70 backdrop-blur-md border border-surface-200 rounded-md p-2">
            {addons.map(a => (
              <Checkbox
                key={a._id}
                checked={form.addonIds.includes(a._id)}
                onChange={() => toggleId('addonIds', a._id)}
                label={a.admin_title || a.display_title || a._id}
              />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowNewAddon(s => !s)}
          className="self-start text-xs font-medium text-amber-300 hover:text-amber-200"
        >
          {showNewAddon ? '− Cancel new add-on' : '+ New add-on'}
        </button>
        {showNewAddon && (
          <div className="space-y-3 rounded-lg border border-amber-300/40 bg-white/5 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-200">New add-on</h3>
            <Field label="Title (required)">
              <Input value={addonForm.admin_title} onChange={v => setAddonForm(f => ({ ...f, admin_title: v }))} />
            </Field>
            <Field label="Display name">
              <Input value={addonForm.display_title} onChange={v => setAddonForm(f => ({ ...f, display_title: v }))} />
            </Field>
            <Field label={`Price (${CUR})`}>
              <Input type="number" value={addonForm.price} onChange={v => setAddonForm(f => ({ ...f, price: v }))} />
            </Field>
            {addonError && (
              <p className={ERROR_NOTE}>{addonError}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitNewAddon}
                disabled={addonSubmitting}
                className="flex-1 py-2 rounded-lg text-sm font-semibold bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50 transition-colors"
              >
                {addonSubmitting ? 'Saving…' : 'Save add-on'}
              </button>
              <button
                type="button"
                onClick={() => { setShowNewAddon(false); setAddonForm(EMPTY_ADDON_FORM); setAddonError(null) }}
                className="px-3 py-2 rounded-lg text-sm font-medium text-white/80 hover:text-white border border-white/30"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Section>

      {error && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{error}</p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 py-3 rounded-xl font-semibold bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50 transition-colors"
        >
          {submitting ? (mode === 'create' ? 'Creating…' : 'Saving…') : (submitLabel ?? defaultSubmitLabel)}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-3 rounded-xl font-medium text-white/80 hover:text-white border border-white/30"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function TypePill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-2 px-4 rounded-xl font-semibold border transition-colors ${
        active
          ? 'bg-brand-600 border-brand-600 text-white'
          : 'bg-white/10 border-white/30 text-white/80 hover:bg-white/20'
      }`}
    >
      {children}
    </button>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-white/70">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-white/80">{label}</span>
      {children}
    </label>
  )
}

// Wix media references look like
//   wix:image://v1/<id>/<filename>#originWidth=…&originHeight=…
// Wix Velo reads them directly for hero / gallery rendering. We don't
// resolve or validate beyond a soft prefix hint — admins paste in
// whatever the Wix Media Manager hands them.
function WixImageField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  const trimmed = value.trim()
  const looksRight = trimmed === '' || trimmed.startsWith('wix:image://')
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-white/80">{label}</span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="wix:image://v1/…/…jpg#originWidth=…&originHeight=…"
        className={INPUT_CLASS}
      />
      {!looksRight && (
        <span className="block text-[11px] text-amber-300">
          Expected a Wix media URI starting with <code>wix:image://</code>. Save anyway if you've pasted a different format on purpose.
        </span>
      )}
    </label>
  )
}

const INPUT_CLASS =
  'w-full bg-white/80 border border-surface-200 rounded-md px-3 py-2 text-sm text-brand-900 ' +
  'placeholder:text-brand-900/40 focus:outline-none focus:border-accent'

function Input({
  value, onChange, type = 'text', required = false, placeholder,
}: { value: string; onChange: (v: string) => void; type?: string; required?: boolean; placeholder?: string }) {
  // Dates route through DateField so they can be typed, not just picked from
  // a (sometimes month-at-a-time) native calendar.
  if (type === 'date') {
    return <DateField value={value} onChange={onChange} required={required} className={INPUT_CLASS} />
  }
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      required={required}
      placeholder={placeholder}
      className={INPUT_CLASS}
    />
  )
}

function Textarea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={3}
      className={INPUT_CLASS}
    />
  )
}

function Select({
  value, onChange, children,
}: { value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={INPUT_CLASS}>
      {children}
    </select>
  )
}

function Checkbox({
  checked, onChange, label,
}: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-white/90 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="accent-brand-600 w-4 h-4"
      />
      <span>{label}</span>
    </label>
  )
}
