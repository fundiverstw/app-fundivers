import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { EOAddon, EOPrice, EORoom } from '../../types/database'

// Admin-facing form for creating a new EO_dive or EO_course. Exposes every
// editable column on the chosen table (system fields like _id / Created Date
// / Owner are auto-populated by the DB). Submit inserts the row, then
// redirects to the new event's admin detail page.
//
// Columns are normalized:
//   - "title" maps to dive_title (dives, NOT NULL) or course_title (courses).
//   - "Start time" maps to `time` (dives) or `start_time` (courses) — the
//     storage names diverge but the semantic is one field.
//   - other_addons is JSON-stringified so the existing sync trigger fans it
//     into eo_dive_addons / eo_course_addons.
//   - room_types (dives) is CSV per the column convention.
//   - nitrox_required (dives) is text 'true'/'false' per legacy convention.

type EventType = 'dive' | 'course'

interface FormState {
  // common
  type: EventType
  title: string          // → dive_title or course_title (required for dives)
  subtitle: string       // → title column (alt label)
  start_date: string
  start_time: string     // 'HH:mm' or empty
  end_date: string
  price: string          // FK → EO_prices._id; empty = no price linked
  featured_image: string
  prereqs: string
  req_dives: string      // dives store bigint, courses store text — keep as string here
  dive_days: string      // bigint or empty
  addonIds: string[]     // FK multi → Other_Addons
  // dive
  notes: string          // dive-only NOT NULL
  featured: boolean
  fully_booked: boolean
  has_rooms: boolean
  roomIds: string[]      // FK multi → EO_rooms (CSV-encoded)
  nitrox_required: boolean
  gear_rental: string
  cancel_date: string
  cancel_policy: string
  destination_reference: string
  second_image: string
  divetravel_reference: string
  // course
  special_date: string
  url: string
  course_name: string
  included: string
  schedule: string
  starting_at: string    // integer or empty
}

const EMPTY_FORM: FormState = {
  type: 'dive',
  title: '', subtitle: '',
  start_date: '', start_time: '', end_date: '',
  price: '', featured_image: '', prereqs: '',
  req_dives: '', dive_days: '',
  addonIds: [],
  notes: '', featured: false, fully_booked: false,
  has_rooms: false, roomIds: [],
  nitrox_required: false, gear_rental: '',
  cancel_date: '', cancel_policy: '',
  destination_reference: '', second_image: '', divetravel_reference: '',
  special_date: '', url: '', course_name: '',
  included: '', schedule: '', starting_at: '',
}

export function AdminNewEventPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [prices, setPrices] = useState<EOPrice[]>([])
  const [rooms, setRooms] = useState<EORoom[]>([])
  const [addons, setAddons] = useState<EOAddon[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [pricesRes, roomsRes, addonsRes] = await Promise.all([
        supabase.from('EO_prices').select('*').order('title'),
        supabase.from('EO_rooms').select('*').order('display_name'),
        supabase.from('Other_Addons').select('*').order('display_name'),
      ])
      if (cancelled) return
      setPrices((pricesRes.data ?? []) as EOPrice[])
      setRooms((roomsRes.data ?? []) as EORoom[])
      setAddons((addonsRes.data ?? []) as EOAddon[])
    })()
    return () => { cancelled = true }
  }, [])

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
      const id = crypto.randomUUID()
      // Bubble's time format includes seconds; pad if the input was 'HH:mm'.
      const timeText = form.start_time ? `${form.start_time}:00` : ''
      const addonsJson = form.addonIds.length ? JSON.stringify(form.addonIds) : ''

      if (form.type === 'dive') {
        const payload = {
          _id: id,
          dive_title: form.title.trim(),
          title: form.subtitle || null,
          start_date: form.start_date || null,
          time: timeText || null,
          end_date: form.end_date || null,
          price: form.price || null,
          featured_image: form.featured_image || null,
          second_image: form.second_image || null,
          notes: form.notes,                   // NOT NULL — empty string OK
          featured: form.featured,
          fully_booked: form.fully_booked,
          prereqs: form.prereqs || null,
          req_dives: form.req_dives ? Number(form.req_dives) : null,
          dive_days: form.dive_days ? Number(form.dive_days) : null,
          gear_rental: form.gear_rental || null,
          nitrox_required: form.nitrox_required ? 'true' : 'false',
          has_rooms: form.has_rooms,
          room_types: form.roomIds.join(','),
          hasotheraddons: form.addonIds.length > 0,
          other_addons: addonsJson,
          cancel_date: form.cancel_date || null,
          cancel_policy: form.cancel_policy || null,
          destination_reference: form.destination_reference || null,
          DiveTravel_reference: form.divetravel_reference || null,
        }
        const { error: insErr } = await supabase.from('EO_dives').insert(payload as never)
        if (insErr) throw insErr
        navigate(`/admin/events/dive/${id}`)
      } else {
        const payload = {
          _id: id,
          course_title: form.title.trim() || null,
          title: form.subtitle || null,
          course_name: form.course_name || null,
          start_date: form.start_date || null,
          start_time: timeText || null,
          end_date: form.end_date || null,
          special_date: form.special_date || null,
          price: form.price || null,
          featured_image: form.featured_image || null,
          URL: form.url || null,
          prereqs: form.prereqs || null,
          req_dives: form.req_dives || null,    // text on courses
          dive_days: form.dive_days ? Number(form.dive_days) : null,
          included: form.included || null,
          schedule: form.schedule || null,
          starting_at: form.starting_at ? Number(form.starting_at) : null,
          other_addons: addonsJson,
        }
        const { error: insErr } = await supabase.from('EO_courses').insert(payload as never)
        if (insErr) throw insErr
        navigate(`/admin/events/course/${id}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-4">New event</h1>

      <div className="flex gap-2 mb-4">
        <TypePill active={form.type === 'dive'}   onClick={() => set('type', 'dive')}>Dive</TypePill>
        <TypePill active={form.type === 'course'} onClick={() => set('type', 'course')}>Course</TypePill>
      </div>

      <form onSubmit={submit} className="space-y-6">
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
                <option key={p._id} value={p._id}>{p.title}{p.starting_at ? ` (${p.starting_at})` : ''}</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Required dives">
              <Input value={form.req_dives} onChange={v => set('req_dives', v)} />
            </Field>
            <Field label="Dive days">
              <Input type="number" value={form.dive_days} onChange={v => set('dive_days', v)} />
            </Field>
          </div>
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
            {submitting ? 'Creating…' : `Create ${form.type === 'dive' ? 'dive' : 'course'}`}
          </button>
          <button
            type="button"
            onClick={() => navigate('/admin/events')}
            className="px-4 py-3 rounded-xl font-medium text-white/80 hover:text-white border border-white/30"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
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
