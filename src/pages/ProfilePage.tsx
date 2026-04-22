import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { pushSupported, getPushSubscription, subscribeToPush, unsubscribeFromPush } from '../lib/push'

// Schema intentionally matches what the HTML form emits (strings for text +
// number inputs, booleans for checkboxes). Numeric/enum coercion happens in
// onSubmit so the input and output types of this schema are identical, which
// keeps react-hook-form happy.
const schema = z.object({
  full_name: z.string().min(1, 'Required'),
  display_name: z.string().optional(),
  phone: z.string().optional(),
  date_of_birth: z.string().optional(),
  nationality: z.string().optional(),
  id_number: z.string().optional(),
  emergency_contact_name: z.string().optional(),
  emergency_contact_phone: z.string().optional(),
  cert_agency: z.string().optional(),
  cert_level: z.string().optional(),
  cert_number: z.string().optional(),
  cert_date: z.string().optional(),
  medical_notes: z.string().optional(),
  height_cm: z.union([z.string(), z.number()]).optional(),
  weight_kg: z.union([z.string(), z.number()]).optional(),
  shoe_size: z.string().optional(),
  gender: z.string().optional(),
  contact_method: z.string().optional(),
  contact_id: z.string().optional(),
  nitrox_certified: z.boolean().optional(),
  logged_dives: z.union([z.string(), z.number()]).optional(),
  last_dive_date: z.string().optional(),
})
type FormData = z.infer<typeof schema>

function numOrNull(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}
function strOrNull(v: unknown): string | null {
  if (v === '' || v === null || v === undefined) return null
  return String(v)
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

const inputClass = 'w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 text-sm focus:outline-none focus:border-sky-500'

export function ProfilePage() {
  const { user, profile } = useAuth()
  const { register, handleSubmit, reset, formState: { errors, isSubmitting, isDirty } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (profile) reset(profile as unknown as FormData)
  }, [profile, reset])

  async function onSubmit(data: FormData) {
    if (!user) return
    const method = data.contact_method
    await supabase.from('profiles').upsert({
      id: user.id,
      full_name: data.full_name,
      display_name: strOrNull(data.display_name),
      phone: strOrNull(data.phone),
      date_of_birth: strOrNull(data.date_of_birth),
      nationality: strOrNull(data.nationality),
      id_number: strOrNull(data.id_number),
      emergency_contact_name: strOrNull(data.emergency_contact_name),
      emergency_contact_phone: strOrNull(data.emergency_contact_phone),
      cert_agency: strOrNull(data.cert_agency),
      cert_level: strOrNull(data.cert_level),
      cert_number: strOrNull(data.cert_number),
      cert_date: strOrNull(data.cert_date),
      medical_notes: strOrNull(data.medical_notes),
      height_cm: numOrNull(data.height_cm),
      weight_kg: numOrNull(data.weight_kg),
      shoe_size: strOrNull(data.shoe_size),
      gender: strOrNull(data.gender),
      contact_method: (method === 'whatsapp' || method === 'line' || method === 'phone' || method === 'email') ? method : null,
      contact_id: strOrNull(data.contact_id),
      nitrox_certified: Boolean(data.nitrox_certified),
      logged_dives: numOrNull(data.logged_dives) ?? 0,
      last_dive_date: strOrNull(data.last_dive_date),
      updated_at: new Date().toISOString(),
    })
    reset(data)
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-bold text-slate-100">My Profile</h1>

      <NotificationsToggle />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <section className="bg-slate-800 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-sky-400 uppercase tracking-wider">Personal Info</h2>
          <Field label="Full name">
            <input {...register('full_name')} className={inputClass} />
            {errors.full_name && <p className="text-red-400 text-xs mt-1">{errors.full_name.message}</p>}
          </Field>
          <Field label="Display name"><input {...register('display_name')} className={inputClass} /></Field>
          <Field label="Phone"><input {...register('phone')} type="tel" className={inputClass} /></Field>
          <Field label="Date of birth"><input {...register('date_of_birth')} type="date" className={inputClass} /></Field>
          <Field label="Nationality"><input {...register('nationality')} className={inputClass} /></Field>
          <Field label="ID / Passport number"><input {...register('id_number')} className={inputClass} /></Field>
          <Field label="Gender">
            <select {...register('gender')} className={inputClass}>
              <option value="">—</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>
          </Field>
        </section>

        <section className="bg-slate-800 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-sky-400 uppercase tracking-wider">Preferred contact</h2>
          <Field label="Method">
            <select {...register('contact_method')} className={inputClass}>
              <option value="">—</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="line">Line</option>
              <option value="phone">Phone</option>
              <option value="email">Email</option>
            </select>
          </Field>
          <Field label="Handle / number">
            <input {...register('contact_id')} className={inputClass} placeholder="e.g. +886-900… or a Line ID" />
          </Field>
        </section>

        <section className="bg-slate-800 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-sky-400 uppercase tracking-wider">Sizing</h2>
          <Field label="Height (cm)"><input {...register('height_cm')} type="number" step="0.1" className={inputClass} /></Field>
          <Field label="Weight (kg)"><input {...register('weight_kg')} type="number" step="0.1" className={inputClass} /></Field>
          <Field label="Shoe size"><input {...register('shoe_size')} className={inputClass} placeholder="e.g. EU 41 / US 9" /></Field>
        </section>

        <section className="bg-slate-800 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-sky-400 uppercase tracking-wider">Emergency Contact</h2>
          <Field label="Name"><input {...register('emergency_contact_name')} className={inputClass} /></Field>
          <Field label="Phone"><input {...register('emergency_contact_phone')} type="tel" className={inputClass} /></Field>
        </section>

        <section className="bg-slate-800 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-sky-400 uppercase tracking-wider">Certification</h2>
          <Field label="Agency (e.g. PADI, SSI)"><input {...register('cert_agency')} className={inputClass} /></Field>
          <Field label="Level (e.g. Open Water)"><input {...register('cert_level')} className={inputClass} /></Field>
          <Field label="Cert number"><input {...register('cert_number')} className={inputClass} /></Field>
          <Field label="Cert date"><input {...register('cert_date')} type="date" className={inputClass} /></Field>
          <Field label="Logged dives"><input {...register('logged_dives')} type="number" min="0" className={inputClass} /></Field>
          <Field label="Last dive"><input {...register('last_dive_date')} type="date" className={inputClass} /></Field>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" {...register('nitrox_certified')} className="accent-sky-500" />
            Nitrox certified
          </label>
        </section>

        <section className="bg-slate-800 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-sky-400 uppercase tracking-wider">Medical Notes</h2>
          <textarea
            {...register('medical_notes')}
            rows={3}
            className={`${inputClass} resize-none`}
            placeholder="Allergies, conditions, medications…"
          />
        </section>

        <button
          type="submit"
          disabled={isSubmitting || !isDirty}
          className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white font-semibold py-2 rounded-lg transition-colors"
        >
          {isSubmitting ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </div>
  )
}

type PushState = 'loading' | 'unsupported' | 'on' | 'off'

export function NotificationsToggle() {
  const [state, setState] = useState<PushState>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!pushSupported()) { if (!cancelled) setState('unsupported'); return }
      const sub = await getPushSubscription()
      if (!cancelled) setState(sub ? 'on' : 'off')
    })()
    return () => { cancelled = true }
  }, [])

  async function toggle(on: boolean) {
    setError(null)
    setBusy(true)
    try {
      if (on) { await subscribeToPush();   setState('on') }
      else    { await unsubscribeFromPush(); setState('off') }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update notifications.')
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading') return null

  if (state === 'unsupported') {
    return (
      <section className="bg-slate-800 rounded-xl p-4 space-y-2" aria-label="Push Notifications">
        <h2 className="text-sm font-semibold text-sky-400 uppercase tracking-wider">Push Notifications</h2>
        <p className="text-sm text-slate-400">
          Your device doesn't support push notifications in this browser.
          On iPhone/iPad, install FunDivers to your Home Screen
          (Share → Add to Home Screen), open the app from there, and the toggle will appear.
        </p>
      </section>
    )
  }

  return (
    <section className="bg-slate-800 rounded-xl p-4 space-y-3" aria-label="Push Notifications">
      <h2 className="text-sm font-semibold text-sky-400 uppercase tracking-wider">Push Notifications</h2>
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm text-slate-200">Event &amp; payment reminders</span>
        <input
          type="checkbox"
          aria-label="Enable push notifications"
          className="accent-sky-500 scale-125"
          disabled={busy}
          checked={state === 'on'}
          onChange={(e) => toggle(e.target.checked)}
        />
      </label>
      <p className="text-xs text-slate-500">
        Reminders fire 1 week and 1 day before each event, plus payment nudges
        at 3 / 2 / 1 weeks and 3 / 1 days before. iOS requires installing the
        app to your Home Screen.
      </p>
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </section>
  )
}
