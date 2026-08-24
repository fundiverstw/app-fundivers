import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/errors'
import { fetchEventRelations } from '../../lib/event-relations'
import { siteConfig } from '../../config/site'
import type { CancellationPolicy, CertLevel, DiveSite, TripTemplateEntry, EOAddon, EventRow, EOPrice, EORoom, TravelDestination } from '../../types/database'
import {
  EMPTY_FORM,
  formStateFromEvent,
  type FormState,
} from './event-form-state'
import { DateField } from '../DateField'
import { usesCourseDays, usesDateEnvelope, hasDiveFlags, recordsSiteConditions } from '../../lib/event-kinds'
import { EVENT_KIND_LABELS } from '../../lib/event-kind-labels'
import { EVENT_KINDS } from '../../types/database'
import { DATE_ENVELOPE_KINDS, COURSE_DAY_KINDS } from '../../lib/event-kinds'
import { newestPerGroup, type PastEventOption } from '../../lib/event-preload'
import { BTN_XS_GHOST, ERROR_NOTE } from '../../styles/tokens'
import { t } from '../../i18n'

// Shared form for creating and editing an EO_dive / EO_course. Owns all
// field state, the lookup data (prices / rooms / addons / cert levels),
// and the inline price-tier sub-form. The parent (AdminNewEventPage,
// AdminEditEventPage) is responsible for the actual DB write + post-
// submit navigation; the form just hands back the validated FormState.

// The subset of an event the preload picker needs to label a row. Selecting
// these instead of `*` keeps the create form from downloading every column of
// every past event just to populate a dropdown.
const PRELOAD_COLS = 'id, kind, admin_title, display_title, start_date, course_days'
type PreloadRow = Pick<EventRow, 'id' | 'kind' | 'admin_title' | 'display_title' | 'start_date' | 'course_days'>

const ef = t.admin.eventForm
const cat = t.admin.catalog

const CUR = siteConfig.locale.currencyLabel

// "Standard (total: 5000 NTD / deposit: 1500 NTD)" — drops parts that
// aren't set so a tier with only one of the two prices doesn't render an
// awkward placeholder.
function priceOptionLabel(p: EOPrice): string {
  const parts: string[] = []
  if (p.starting_at != null)    parts.push(ef.totalPart(p.starting_at, CUR))
  if (p.deposit_amount != null) parts.push(ef.depositPart(p.deposit_amount, CUR))
  return parts.length ? `${p.admin_title} (${parts.join(' / ')})` : p.admin_title
}

// Sub-form state for creating a brand-new prices row inline (so admins
// don't have to leave the form just to define a price tier).
interface PriceFormState {
  admin_title: string
  price: string             // human label, e.g. "NT$10,000"
  starting_at: string       // bigint or empty
  deposit_amount: string    // bigint or empty
  // Per-event room options live in the event_rooms junction table. prices
  // no longer carries a room_options column.
  transport: string
}

const EMPTY_PRICE_FORM: PriceFormState = {
  admin_title: '', price: '', starting_at: '', deposit_amount: '', transport: '',
}

// Sub-form state for inline rooms / addons / trip_templates inserts.
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
  /** Extra create-mode section (car assignment, recurrence) rendered above the
   *  submit buttons. Receives the live form so it can key off the kind AND the
   *  dates already entered — a repeat pattern is meaningless without an anchor.
   *  Edit mode has its own persisted sections, so this is ignored there. */
  renderCreateExtras?: (form: FormState) => React.ReactNode
}

export function EventForm({ mode, initial, onSubmit, onCancel, submitLabel, renderCreateExtras }: EventFormProps) {
  const [form, setForm] = useState<FormState>(initial ?? EMPTY_FORM)
  const [prices, setPrices] = useState<EOPrice[]>([])
  const [rooms, setRooms] = useState<EORoom[]>([])
  const [addons, setAddons] = useState<EOAddon[]>([])
  const [certLevels, setCertLevels] = useState<CertLevel[]>([])
  const [cancelPolicies, setCancelPolicies] = useState<CancellationPolicy[]>([])
  const [tripTemplates, setTripTemplates] = useState<TripTemplateEntry[]>([])
  const [destinations, setDestinations] = useState<TravelDestination[]>([])
  const [diveSites, setDiveSites] = useState<DiveSite[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Past events for the preload picker, sorted most-recent-first.
  const [pastEvents, setPastEvents] = useState<PastEventOption[]>([])
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
        supabase.from('prices').select('*').order('admin_title'),
        supabase.from('rooms').select('*').order('admin_title'),
        supabase.from('addons').select('*').order('admin_title'),
        // Only the columns the picker labels rows with — the full row is
        // fetched when the admin actually picks one.
        mode === 'create'
          ? supabase.from('events').select(PRELOAD_COLS).in('kind', DATE_ENVELOPE_KINDS).lt('start_date', todayStr).order('start_date', { ascending: false }).limit(50)
          : Promise.resolve({ data: [] as PreloadRow[] }),
        // Course-day kinds have no scalar date column to filter/order on —
        // fetch a bounded set and narrow to "past" client-side via course_days.
        mode === 'create'
          ? supabase.from('events').select(PRELOAD_COLS).in('kind', COURSE_DAY_KINDS).limit(200)
          : Promise.resolve({ data: [] as PreloadRow[] }),
        supabase.from('cert_levels').select('*').order('rank'),
        supabase.from('cancellation_policies').select('*').order('title'),
        supabase.from('trip_templates').select('*').order('admin_title'),
        supabase.from('travel_destinations').select('*').order('sort_order', { nullsFirst: false }),
        supabase.from('dive_sites').select('*').eq('active', true).order('name'),
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
      setTripTemplates(dataOf<TripTemplateEntry>(7))
      setDestinations(dataOf<TravelDestination>(8))
      setDiveSites(dataOf<DiveSite>(9))

      // Both lists collapse to the newest event per admin_title — the site for
      // a dive or adventure, the course type for a course. The shop returns to
      // the same places and reruns the same courses, so listing every past
      // occurrence made the picker unusable and told the admin nothing the
      // newest one doesn't.
      const pastEnvelope = newestPerGroup(
        dataOf<PreloadRow>(3).map<PastEventOption>(d => ({
          kind: d.kind,
          id: d.id,
          startDate: d.start_date ?? '',
          title: d.display_title ?? d.admin_title ?? ef.untitled(EVENT_KIND_LABELS[d.kind]),
          groupKey: d.admin_title ?? null,
        })),
      )
      const pastCourses = newestPerGroup(
        dataOf<PreloadRow>(4)
          .map<PastEventOption>(c => ({
            kind: c.kind,
            id: c.id,
            startDate: [...(c.course_days ?? [])].filter(Boolean).sort()[0] ?? '',
            title: c.display_title ?? c.admin_title ?? ef.untitled(EVENT_KIND_LABELS[c.kind]),
            groupKey: c.admin_title ?? null,
          }))
          .filter(c => c.startDate && c.startDate < todayStr),
      )
      const merged = [...pastEnvelope, ...pastCourses].sort((a, b) => b.startDate.localeCompare(a.startDate))
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
    if (prices.length && next.price && !prices.some(p => p.id === next.price)) next.price = ''
    if (cancelPolicies.length && next.cancel_policy && !cancelPolicies.some(p => p.id === next.cancel_policy)) next.cancel_policy = ''
    if (diveSites.length && next.site_id && !diveSites.some(site => site.id === next.site_id)) next.site_id = ''
    return next
  }

  const filteredPastEvents = pastEvents.filter(p => p.kind === form.type)

  async function applyPreload(p: PastEventOption) {
    // The picker carries only enough to label a row, so pull the full event
    // here. Rooms/add-ons/destinations live in the junction tables, so fetch
    // those too to clone the whole config.
    const [rowResp, rels] = await Promise.all([
      supabase.from('events').select('*').eq('id', p.id).single(),
      fetchEventRelations(p.id),
    ])
    const row = rowResp.data as EventRow | null
    if (!row) return
    setForm(formStateFromEvent(row, rels))
  }

  function handlePreload(id: string) {
    setPreloadId(id)
    if (!id) return
    const found = pastEvents.find(p => p.id === id)
    if (found) void applyPreload(found)
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
      setPriceError(t.admin.waivers.titleRequired)
      return
    }
    setPriceSubmitting(true)
    try {
      const id = crypto.randomUUID()
      const payload = {
        id,
        admin_title: priceForm.admin_title.trim(),
        price: priceForm.price || null,
        starting_at: priceForm.starting_at ? Number(priceForm.starting_at) : null,
        deposit_amount: priceForm.deposit_amount ? Number(priceForm.deposit_amount) : null,
        transport: priceForm.transport ? Number(priceForm.transport) : null,
      }
      const { error: insErr } = await supabase.from('prices').insert(payload as never)
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
    if (!roomForm.admin_title.trim()) { setRoomError(t.admin.waivers.titleRequired); return }
    setRoomSubmitting(true)
    try {
      const id = crypto.randomUUID()
      const payload = {
        id,
        admin_title: roomForm.admin_title.trim(),
        display_title: roomForm.display_title.trim() || null,
        added_price: roomForm.added_price ? Number(roomForm.added_price) : null,
      }
      const { error: insErr } = await supabase.from('rooms').insert(payload as never)
      if (insErr) throw insErr
      setRooms(rs => [...rs, payload as unknown as EORoom].sort(
        (a, b) => (a.admin_title ?? a.display_title ?? '').localeCompare(b.admin_title ?? b.display_title ?? '')
      ))
      // Auto-tick the new room so admins don't have to scroll back.
      setForm(f => ({ ...f, roomIds: [...f.roomIds, id] }))
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
    if (!addonForm.admin_title.trim()) { setAddonError(t.admin.waivers.titleRequired); return }
    setAddonSubmitting(true)
    try {
      const id = crypto.randomUUID()
      const payload = {
        id,
        admin_title: addonForm.admin_title.trim(),
        display_title: addonForm.display_title.trim() || null,
        price: addonForm.price ? Number(addonForm.price) : null,
      }
      const { error: insErr } = await supabase.from('addons').insert(payload as never)
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
    if (!travelForm.admin_title.trim()) { setTravelError(t.admin.waivers.titleRequired); return }
    setTravelSubmitting(true)
    try {
      const id = crypto.randomUUID()
      const payload = {
        id,
        admin_title: travelForm.admin_title.trim(),
        included: travelForm.included || null,
        not_included: travelForm.not_included || null,
        transportation: travelForm.transportation || null,
      }
      const { error: insErr } = await supabase.from('trip_templates').insert(payload as never)
      if (insErr) throw insErr
      setTripTemplates(ts => [...ts, payload as unknown as TripTemplateEntry].sort(
        (a, b) => (a.admin_title ?? '').localeCompare(b.admin_title ?? '')
      ))
      set('trip_template_reference', id)
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
    if (usesDateEnvelope(form.type)) {
      if (!form.admin_title.trim()) {
        setError(ef.adminTitleRequired)
        return
      }
      if (!form.start_date) {
        setError(ef.startDateRequired)
        return
      }
    } else if (!form.courseDays.some(Boolean)) {
      setError(ef.courseDayRequired)
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
    ? ef.createEvent(EVENT_KIND_LABELS[form.type])
    : cat.saveChanges

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* Type switch is create-only — switching dive↔course on an existing row
          would require migrating to the other table, which we don't support. */}
      {mode === 'create' && (
        <div className="flex gap-2">
          {EVENT_KINDS.map(kind => (
            <TypePill
              key={kind}
              active={form.type === kind}
              onClick={() => { set('type', kind); setPreloadId('') }}
            >
              {EVENT_KIND_LABELS[kind]}
            </TypePill>
          ))}
        </div>
      )}

      {mode === 'create' && filteredPastEvents.length > 0 && (
        <div>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-white/80">
              {ef.preloadPast(EVENT_KIND_LABELS[form.type])}
            </span>
            <select
              value={preloadId}
              onChange={e => handlePreload(e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">{ef.startFresh}</option>
              {filteredPastEvents.map(p => (
                <option key={p.id} value={p.id}>
                  {p.startDate || '????-??-??'} — {p.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <Section title={ef.sectionBasics}>
        <Field label={usesCourseDays(form.type) ? ef.adminTitleLabelOptional : ef.adminTitleLabelRequired}>
          <Input value={form.admin_title} onChange={v => set('admin_title', v)} required={!usesCourseDays(form.type)} />
        </Field>
        <Field label={ef.displayTitle}>
          <Input value={form.display_title} onChange={v => set('display_title', v)} />
        </Field>
        <Field label={ef.calendarTitle}>
          <Input value={form.calendar_title} onChange={v => set('calendar_title', v)} />
        </Field>
        {usesDateEnvelope(form.type) ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label={ef.startDate}>
              <Input type="date" value={form.start_date} onChange={v => set('start_date', v)} required />
            </Field>
            <Field label={ef.startTime}>
              <Input type="time" value={form.start_time} onChange={v => set('start_time', v)} />
            </Field>
            <Field label={ef.endDate}>
              <Input type="date" value={form.end_date} onChange={v => set('end_date', v)} />
            </Field>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <span className="text-xs font-medium text-white/80">{ef.courseDays}</span>
              <p className="text-xs text-white/60">{ef.courseDaysHint}</p>
            </div>
            <div className="space-y-2">
              {form.courseDays.map((day, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input type="date" value={day} onChange={v => setCourseDay(i, v)} />
                  <button
                    type="button"
                    onClick={() => removeCourseDay(i)}
                    className="px-2 py-1 rounded-md text-xs font-medium text-white/80 hover:text-white border border-white/30"
                    aria-label={ef.removeDayAria(i + 1)}
                  >
                    {ef.remove}
                  </button>
                </div>
              ))}
            </div>
            {form.courseDays.length < 4 && (
              <button
                type="button"
                onClick={addCourseDay}
                className={`self-start ${BTN_XS_GHOST}`}
              >
                {ef.addDay}
              </button>
            )}
            <Field label={ef.startTime}>
              <Input type="time" value={form.start_time} onChange={v => set('start_time', v)} />
            </Field>
          </div>
        )}
        <Field label={ef.priceTier}>
          <Select value={form.price} onChange={v => set('price', v)}>
            <option value="">{ef.none}</option>
            {prices.map(p => (
              <option key={p.id} value={p.id}>{priceOptionLabel(p)}</option>
            ))}
          </Select>
        </Field>
        <button
          type="button"
          onClick={() => setShowNewPrice(s => !s)}
          className={`-mt-2 self-start ${BTN_XS_GHOST}`}
        >
          {showNewPrice ? ef.cancelNewTier : ef.newPriceTier}
        </button>
        {showNewPrice && (
          <div className="space-y-3 rounded-lg border border-amber-300/40 bg-white/5 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-200">{ef.newPriceTierTitle}</h3>
            <Field label={ef.titleRequiredLabel}>
              <Input value={priceForm.admin_title} onChange={v => setPriceForm(f => ({ ...f, admin_title: v }))} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={ef.priceLabel}>
                <Input value={priceForm.price} onChange={v => setPriceForm(f => ({ ...f, price: v }))} />
              </Field>
              <Field label={cat.prices.startingAt}>
                <Input type="number" value={priceForm.starting_at} onChange={v => setPriceForm(f => ({ ...f, starting_at: v }))} />
              </Field>
              <Field label={ef.depositAmount}>
                <Input type="number" value={priceForm.deposit_amount} onChange={v => setPriceForm(f => ({ ...f, deposit_amount: v }))} />
              </Field>
            </div>
            <Field label={ef.transportField(CUR)}>
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
                {priceSubmitting ? cat.saving : ef.savePriceTier}
              </button>
              <button
                type="button"
                onClick={() => { setShowNewPrice(false); setPriceForm(EMPTY_PRICE_FORM); setPriceError(null) }}
                className="px-3 py-2 rounded-lg text-sm font-medium text-white/80 hover:text-white border border-white/30"
              >
                {cat.cancel}
              </button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={ef.requiredDives}>
            <Input value={form.req_dives} onChange={v => set('req_dives', v)} />
          </Field>
          <Field label={ef.diveDays}>
            <Input type="number" value={form.dive_days} onChange={v => set('dive_days', v)} />
          </Field>
          <Field label={ef.capacity}>
            <Input type="number" value={form.capacity} onChange={v => set('capacity', v)} placeholder={ef.capacityPlaceholder} />
          </Field>
        </div>
        {recordsSiteConditions(form.type) && (
          <Field label={ef.site}>
            <Select value={form.site_id} onChange={v => set('site_id', v)}>
              <option value="">{ef.none}</option>
              {diveSites.filter(site => site.kind === form.type).map(site => (
                <option key={site.id} value={site.id}>
                  {site.region ? `${site.name} — ${site.region}` : site.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={ef.requiredCert}>
          <Select value={form.prereq_cert_id} onChange={v => set('prereq_cert_id', v)}>
            <option value="">{ef.none}</option>
            {/* Prereqs are encoded as PADI ranks; agency-specific levels carry
                 a padi_equivalent_id so a CMAS 2-Star diver still satisfies a
                 PADI Rescue prereq when that comparison gets wired up. */}
            {certLevels.filter(c => c.organization === 'PADI').map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
      </Section>

      {hasDiveFlags(form.type) && (
        <>
          <Section title={ef.sectionDetails(EVENT_KIND_LABELS[form.type])}>
            <Field label={ef.notes}>
              <Textarea value={form.notes} onChange={v => set('notes', v)} />
            </Field>
            <div className="flex flex-wrap gap-3">
              <Checkbox checked={form.featured}        onChange={v => set('featured', v)}        label={ef.featured} />
              <Checkbox checked={form.fully_booked}    onChange={v => set('fully_booked', v)}    label={ef.fullyBooked} />
              <Checkbox checked={form.nitrox_required} onChange={v => set('nitrox_required', v)} label={ef.nitroxRequired} />
              <Checkbox checked={form.is_boat_dive}    onChange={v => set('is_boat_dive', v)}    label={ef.boatDive} />
              <Checkbox checked={form.is_trip}         onChange={v => set('is_trip', v)}         label={ef.isTrip} />
              <Checkbox checked={form.is_private}      onChange={v => set('is_private', v)}      label={ef.isPrivate} />
            </div>
            <Field label={ef.gearRental}>
              <Input value={form.gear_rental} onChange={v => set('gear_rental', v)} />
            </Field>
            <WixImageField
              label={ef.featuredImage}
              value={form.featured_image}
              onChange={v => set('featured_image', v)}
            />
            <div className="space-y-1">
              <span className="text-xs font-medium text-white/80">{ef.destinations}</span>
              {destinations.length === 0 ? (
                <p className="text-sm text-brand-950 font-medium">{ef.noDestinations}</p>
              ) : (
                <div className="space-y-1 max-h-56 overflow-y-auto bg-white/70 backdrop-blur-md border border-surface-200 rounded-md p-2">
                  {destinations.map(d => (
                    <Checkbox
                      key={d.id}
                      checked={form.destinationIds.includes(d.id)}
                      onChange={() => toggleId('destinationIds', d.id)}
                      label={d.country ? `${d.admin_title ?? d.id} — ${d.country}` : (d.admin_title ?? d.id)}
                    />
                  ))}
                </div>
              )}
            </div>
            <Field label={ef.tripTemplateRef}>
              <Select value={form.trip_template_reference} onChange={v => set('trip_template_reference', v)}>
                <option value="">{ef.none}</option>
                {tripTemplates.map(tt => (
                  <option key={tt.id} value={tt.id}>{tt.admin_title ?? tt.id}</option>
                ))}
              </Select>
            </Field>
            <button
              type="button"
              onClick={() => setShowNewTravel(s => !s)}
              className={`-mt-2 self-start ${BTN_XS_GHOST}`}
            >
              {showNewTravel ? ef.cancelNewEntry : ef.newTripTemplate}
            </button>
            {showNewTravel && (
              <div className="space-y-3 rounded-lg border border-amber-300/40 bg-white/5 p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-200">{ef.newTripTemplateTitle}</h3>
                <Field label={ef.titleRequiredLabel}>
                  <Input value={travelForm.admin_title} onChange={v => setTravelForm(f => ({ ...f, admin_title: v }))} />
                </Field>
                <Field label={cat.travel.included}>
                  <Textarea value={travelForm.included} onChange={v => setTravelForm(f => ({ ...f, included: v }))} />
                </Field>
                <Field label={cat.travel.notIncluded}>
                  <Textarea value={travelForm.not_included} onChange={v => setTravelForm(f => ({ ...f, not_included: v }))} />
                </Field>
                <Field label={cat.travel.transportation}>
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
                    {travelSubmitting ? cat.saving : ef.saveTripTemplate}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowNewTravel(false); setTravelForm(EMPTY_TRAVEL_FORM); setTravelError(null) }}
                    className="px-3 py-2 rounded-lg text-sm font-medium text-white/80 hover:text-white border border-white/30"
                  >
                    {cat.cancel}
                  </button>
                </div>
              </div>
            )}
          </Section>

          <Section title={ef.sectionRooms}>
            <p className="text-xs text-white/60">{ef.roomsBlurb}</p>
            {rooms.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto bg-white/70 backdrop-blur-md border border-surface-200 rounded-md p-2">
                {rooms.map(r => (
                  <Checkbox
                    key={r.id}
                    checked={form.roomIds.includes(r.id)}
                    onChange={() => toggleId('roomIds', r.id)}
                    label={r.admin_title || r.display_title || r.id}
                  />
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowNewRoom(s => !s)}
              className={`self-start ${BTN_XS_GHOST}`}
            >
              {showNewRoom ? ef.cancelNewRoom : ef.newRoomOption}
            </button>
            {showNewRoom && (
              <div className="space-y-3 rounded-lg border border-amber-300/40 bg-white/5 p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-200">{ef.newRoomOptionTitle}</h3>
                <Field label={ef.titleRequiredLabel}>
                  <Input value={roomForm.admin_title} onChange={v => setRoomForm(f => ({ ...f, admin_title: v }))} />
                </Field>
                <Field label={ef.displayName}>
                  <Input value={roomForm.display_title} onChange={v => setRoomForm(f => ({ ...f, display_title: v }))} />
                </Field>
                <Field label={cat.rooms.addedPrice(CUR)}>
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
                    {roomSubmitting ? cat.saving : ef.saveRoomOption}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowNewRoom(false); setRoomForm(EMPTY_ROOM_FORM); setRoomError(null) }}
                    className="px-3 py-2 rounded-lg text-sm font-medium text-white/80 hover:text-white border border-white/30"
                  >
                    {cat.cancel}
                  </button>
                </div>
              </div>
            )}
          </Section>

        </>
      )}

      {usesCourseDays(form.type) && (
        <Section title={ef.sectionDetails(EVENT_KIND_LABELS[form.type])}>
          <Field label={ef.courseName}>
            <Input value={form.course_name} onChange={v => set('course_name', v)} />
          </Field>
          <Field label={cat.travel.included}>
            <Textarea value={form.included} onChange={v => set('included', v)} />
          </Field>
          <Field label={ef.schedule}>
            <Textarea value={form.schedule} onChange={v => set('schedule', v)} />
          </Field>
          <WixImageField
            label={ef.featuredImage}
            value={form.featured_image}
            onChange={v => set('featured_image', v)}
          />
        </Section>
      )}

      <Section title={ef.sectionCancellation}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={ef.cancelByDate}>
            <Input type="date" value={form.cancel_date} onChange={v => set('cancel_date', v)} />
          </Field>
          <Field label={ef.cancelPolicy}>
            <Select value={form.cancel_policy} onChange={v => set('cancel_policy', v)}>
              <option value="">{ef.none}</option>
              {cancelPolicies.map(p => (
                <option key={p.id} value={p.id}>{p.title ?? p.id}</option>
              ))}
            </Select>
            {/* Whether the deposit comes back is decided here, at the moment
                the policy is chosen, because nothing downstream asks again:
                cancelling the booking issues the credit on its own. */}
            {cancelPolicies.find(p => p.id === form.cancel_policy)?.deposit_refundable === false && (
              <p className="text-xs text-amber-800 font-semibold mt-1">{ef.depositNonRefundable}</p>
            )}
          </Field>
        </div>
      </Section>

      <Section title={ef.sectionPaymentDeadline}>
        <p className="text-xs text-white/70">{ef.paymentDeadlineBlurb}</p>
        <Field label={ef.fullPaymentDeadline}>
          <Input type="date" value={form.full_payment_deadline} onChange={v => set('full_payment_deadline', v)} />
        </Field>
      </Section>

      <Section title={t.admin.groups.addons}>
        {addons.length === 0 ? (
          <p className="text-sm text-brand-950 font-medium">{ef.noAddons}</p>
        ) : (
          <div className="space-y-1 max-h-56 overflow-y-auto bg-white/70 backdrop-blur-md border border-surface-200 rounded-md p-2">
            {addons.map(a => (
              <Checkbox
                key={a.id}
                checked={form.addonIds.includes(a.id)}
                onChange={() => toggleId('addonIds', a.id)}
                label={a.admin_title || a.display_title || a.id}
              />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowNewAddon(s => !s)}
          className={`self-start ${BTN_XS_GHOST}`}
        >
          {showNewAddon ? ef.cancelNewAddon : ef.newAddon}
        </button>
        {showNewAddon && (
          <div className="space-y-3 rounded-lg border border-amber-300/40 bg-white/5 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-200">{ef.newAddonTitle}</h3>
            <Field label={ef.titleRequiredLabel}>
              <Input value={addonForm.admin_title} onChange={v => setAddonForm(f => ({ ...f, admin_title: v }))} />
            </Field>
            <Field label={ef.displayName}>
              <Input value={addonForm.display_title} onChange={v => setAddonForm(f => ({ ...f, display_title: v }))} />
            </Field>
            <Field label={cat.addons.price(CUR)}>
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
                {addonSubmitting ? cat.saving : ef.saveAddon}
              </button>
              <button
                type="button"
                onClick={() => { setShowNewAddon(false); setAddonForm(EMPTY_ADDON_FORM); setAddonError(null) }}
                className="px-3 py-2 rounded-lg text-sm font-medium text-white/80 hover:text-white border border-white/30"
              >
                {cat.cancel}
              </button>
            </div>
          </div>
        )}
      </Section>

      {mode === 'create' && renderCreateExtras?.(form)}

      {error && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{error}</p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 py-3 rounded-xl font-semibold bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50 transition-colors"
        >
          {submitting ? (mode === 'create' ? ef.creating : cat.saving) : (submitLabel ?? defaultSubmitLabel)}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-3 rounded-xl font-medium text-white/80 hover:text-white border border-white/30"
        >
          {cat.cancel}
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

// Wraps its child in the <label>, which suits the mixed bag of controls this
// form puts inside it (inputs, selects, custom pickers) — not all of them take
// an id. A DateField's transparent picker input rides along inside, but a
// label skips its activation behaviour for events targeting interactive
// content, so the tap is never re-dispatched onto the labelled control.
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
          {ef.wixHintPrefix}<code>wix:image://</code>{ef.wixHintSuffix}
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
