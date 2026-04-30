import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import type { CertLevel, EOAddon, EOCourse, EODive, EOPrice, EORoom } from '../../types/database'
import {
  EMPTY_FORM,
  formStateFromCourse,
  formStateFromDive,
  type FormState,
} from './event-form-state'

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

// "Standard (total: 5000 NTD / deposit: 1500 NTD)" — drops parts that
// aren't set so a tier with only one of the two prices doesn't render an
// awkward placeholder.
function priceOptionLabel(p: EOPrice): string {
  const parts: string[] = []
  if (p.starting_at != null)    parts.push(`total: ${p.starting_at} NTD`)
  if (p.deposit_amount != null) parts.push(`deposit: ${p.deposit_amount} NTD`)
  return parts.length ? `${p.title} (${parts.join(' / ')})` : p.title
}

// Sub-form state for creating a brand-new EO_prices row inline (so admins
// don't have to leave the form just to define a price tier).
interface PriceFormState {
  title: string
  price: string             // human label, e.g. "NT$10,000"
  starting_at: string       // bigint or empty
  deposit_amount: string    // bigint or empty
  roomIds: string[]         // → EO_prices.room_options (JSON array of EO_rooms._id)
  transport: string
}

const EMPTY_PRICE_FORM: PriceFormState = {
  title: '', price: '', starting_at: '', deposit_amount: '', roomIds: [], transport: '',
}

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
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Past events for the preload picker, sorted most-recent-first.
  const [pastEvents, setPastEvents] = useState<PastEvent[]>([])
  const [preloadId, setPreloadId] = useState<string>('')
  // Price-tier sub-form lives collapsed by default.
  const [showNewPrice, setShowNewPrice] = useState(false)
  const [priceForm, setPriceForm] = useState<PriceFormState>(EMPTY_PRICE_FORM)
  const [priceSubmitting, setPriceSubmitting] = useState(false)
  const [priceError, setPriceError] = useState<string | null>(null)

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
        supabase.from('EO_prices').select('*').order('title'),
        supabase.from('EO_rooms').select('*').order('display_name'),
        supabase.from('Other_Addons').select('*').order('display_name'),
        mode === 'create'
          ? supabase.from('EO_dives').select('*').lt('start_date', todayStr).order('start_date', { ascending: false }).limit(50)
          : Promise.resolve({ data: [] as EODive[] }),
        mode === 'create'
          ? supabase.from('EO_courses').select('*').lt('start_date', todayStr).order('start_date', { ascending: false }).limit(50)
          : Promise.resolve({ data: [] as EOCourse[] }),
        supabase.from('cert_levels').select('*').order('rank'),
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

      const pastDives = dataOf<EODive>(3).map<PastEvent>(d => ({
        kind: 'dive', id: d._id, startDate: d.start_date ?? '', title: d.dive_title ?? '(untitled dive)', row: d,
      }))
      const pastCourses = dataOf<EOCourse>(4).map<PastEvent>(c => ({
        kind: 'course', id: c._id, startDate: c.start_date ?? '', title: c.course_title ?? '(untitled course)', row: c,
      }))
      const merged = [...pastDives, ...pastCourses].sort((a, b) => b.startDate.localeCompare(a.startDate))
      setPastEvents(merged)
    })()
    return () => { cancelled = true }
  }, [mode])

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

  function toggleId(key: 'addonIds' | 'roomIds', id: string) {
    setForm(f => {
      const list = f[key]
      const next = list.includes(id) ? list.filter(x => x !== id) : [...list, id]
      return { ...f, [key]: next }
    })
  }

  function togglePriceRoom(id: string) {
    setPriceForm(f => {
      const next = f.roomIds.includes(id) ? f.roomIds.filter(x => x !== id) : [...f.roomIds, id]
      return { ...f, roomIds: next }
    })
  }

  async function submitNewPrice() {
    setPriceError(null)
    if (!priceForm.title.trim()) {
      setPriceError('Title is required.')
      return
    }
    setPriceSubmitting(true)
    try {
      const id = crypto.randomUUID()
      // room_options stores a JSON array of EO_rooms._id values, matching the
      // legacy Bubble shape so the existing `EO_rooms.added_price` lookup
      // continues to feed per-room pricing for booking flows.
      const roomOptions = priceForm.roomIds.length ? JSON.stringify(priceForm.roomIds) : null
      const payload = {
        _id: id,
        title: priceForm.title.trim(),
        price: priceForm.price || null,
        starting_at: priceForm.starting_at ? Number(priceForm.starting_at) : null,
        deposit_amount: priceForm.deposit_amount ? Number(priceForm.deposit_amount) : null,
        room_options: roomOptions,
        transport: priceForm.transport || null,
      }
      const { error: insErr } = await supabase.from('EO_prices').insert(payload as never)
      if (insErr) throw insErr
      // Optimistically inject so the user can pick the new tier immediately.
      const newRow = {
        ...payload,
        starting_at: payload.starting_at ?? null,
        deposit_amount: payload.deposit_amount ?? null,
      } as unknown as EOPrice
      setPrices(p => [...p, newRow].sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '')))
      set('price', id)
      setPriceForm(EMPTY_PRICE_FORM)
      setShowNewPrice(false)
    } catch (err) {
      setPriceError(err instanceof Error ? err.message : String(err))
    } finally {
      setPriceSubmitting(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Validate the per-type required fields up front.
    if (form.type === 'dive' && !form.title.trim()) {
      setError('Dive title is required.')
      return
    }
    if (!form.start_date) {
      setError('Start date is required.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit(form)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
        <Field label={form.type === 'dive' ? 'Dive title (required)' : 'Course title'}>
          <Input value={form.title} onChange={v => set('title', v)} required={form.type === 'dive'} />
        </Field>
        <Field label="Subtitle (optional)">
          <Input value={form.subtitle} onChange={v => set('subtitle', v)} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
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
              <Input value={priceForm.title} onChange={v => setPriceForm(f => ({ ...f, title: v }))} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
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
            <Field label="Transport">
              <Input value={priceForm.transport} onChange={v => setPriceForm(f => ({ ...f, transport: v }))} />
            </Field>
            <div className="space-y-1">
              <span className="text-xs font-medium text-white/80">Room options</span>
              {rooms.length === 0 ? (
                <p className="text-xs text-white/60">No rooms defined.</p>
              ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto bg-white/70 backdrop-blur-md border border-sky-200 rounded-md p-2">
                  {rooms.map(r => (
                    <Checkbox
                      key={r._id}
                      checked={priceForm.roomIds.includes(r._id)}
                      onChange={() => togglePriceRoom(r._id)}
                      label={r.display_name || r.title || r._id}
                    />
                  ))}
                </div>
              )}
            </div>
            {priceError && (
              <p className="text-xs text-red-200 bg-red-900/50 border border-red-500 rounded-md p-2">{priceError}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitNewPrice}
                disabled={priceSubmitting}
                className="flex-1 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-colors"
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Required dives">
            <Input value={form.req_dives} onChange={v => set('req_dives', v)} />
          </Field>
          <Field label="Dive days">
            <Input type="number" value={form.dive_days} onChange={v => set('dive_days', v)} />
          </Field>
        </div>
        <Field label="Required certification">
          <Select value={form.prereq_cert_id} onChange={v => set('prereq_cert_id', v)}>
            <option value="">— None —</option>
            {certLevels.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Prereqs (free text)">
          <Input value={form.prereqs} onChange={v => set('prereqs', v)} />
        </Field>
        <Field label="Featured image URL">
          <Input value={form.featured_image} onChange={v => set('featured_image', v)} />
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
            </div>
            <Field label="Gear rental info">
              <Input value={form.gear_rental} onChange={v => set('gear_rental', v)} />
            </Field>
            <Field label="Destination reference">
              <Input value={form.destination_reference} onChange={v => set('destination_reference', v)} />
            </Field>
            <Field label="DiveTravel reference">
              <Input value={form.divetravel_reference} onChange={v => set('divetravel_reference', v)} />
            </Field>
            <Field label="Second image URL">
              <Input value={form.second_image} onChange={v => set('second_image', v)} />
            </Field>
          </Section>

          <Section title="Rooms">
            <Checkbox checked={form.has_rooms} onChange={v => set('has_rooms', v)} label="Offers rooms" />
            {form.has_rooms && rooms.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto bg-white/70 backdrop-blur-md border border-sky-200 rounded-md p-2">
                {rooms.map(r => (
                  <Checkbox
                    key={r._id}
                    checked={form.roomIds.includes(r._id)}
                    onChange={() => toggleId('roomIds', r._id)}
                    label={r.display_name || r.title || r._id}
                  />
                ))}
              </div>
            )}
          </Section>

          <Section title="Cancellation">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cancel-by date">
                <Input type="date" value={form.cancel_date} onChange={v => set('cancel_date', v)} />
              </Field>
            </div>
            <Field label="Cancel policy">
              <Textarea value={form.cancel_policy} onChange={v => set('cancel_policy', v)} />
            </Field>
          </Section>
        </>
      )}

      {form.type === 'course' && (
        <Section title="Course details">
          <Field label="Course name">
            <Input value={form.course_name} onChange={v => set('course_name', v)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Special date (extra session)">
              <Input type="date" value={form.special_date} onChange={v => set('special_date', v)} />
            </Field>
            <Field label="Starting at (price)">
              <Input type="number" value={form.starting_at} onChange={v => set('starting_at', v)} />
            </Field>
          </div>
          <Field label="URL">
            <Input value={form.url} onChange={v => set('url', v)} />
          </Field>
          <Field label="Included">
            <Textarea value={form.included} onChange={v => set('included', v)} />
          </Field>
          <Field label="Schedule">
            <Textarea value={form.schedule} onChange={v => set('schedule', v)} />
          </Field>
        </Section>
      )}

      <Section title="Payment deadlines">
        <p className="text-xs text-blue-950 font-medium">
          Shown to divers on the registration form and in the emailed PDF.
          Leave blank to fall back to "7 days before start date".
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Deposit deadline">
            <Input type="date" value={form.deposit_deadline} onChange={v => set('deposit_deadline', v)} />
          </Field>
          <Field label="Full payment deadline">
            <Input type="date" value={form.full_payment_deadline} onChange={v => set('full_payment_deadline', v)} />
          </Field>
        </div>
      </Section>

      <Section title="Add-ons">
        {addons.length === 0 ? (
          <p className="text-sm text-blue-950 font-medium">No add-ons defined.</p>
        ) : (
          <div className="space-y-1 max-h-56 overflow-y-auto bg-white/70 backdrop-blur-md border border-sky-200 rounded-md p-2">
            {addons.map(a => (
              <Checkbox
                key={a._id}
                checked={form.addonIds.includes(a._id)}
                onChange={() => toggleId('addonIds', a._id)}
                label={a.display_name || a.title || a._id}
              />
            ))}
          </div>
        )}
      </Section>

      {error && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-red-500 rounded-md p-2">{error}</p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 py-3 rounded-xl font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-colors"
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
          ? 'bg-blue-600 border-blue-600 text-white'
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

const INPUT_CLASS =
  'w-full bg-white/80 border border-sky-200 rounded-md px-3 py-2 text-sm text-blue-900 ' +
  'placeholder:text-blue-900/40 focus:outline-none focus:border-red-500'

function Input({
  value, onChange, type = 'text', required = false,
}: { value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      required={required}
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
        className="accent-blue-600 w-4 h-4"
      />
      <span>{label}</span>
    </label>
  )
}
