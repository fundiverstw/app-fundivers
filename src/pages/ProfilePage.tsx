import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const optString = () => z.string().optional().nullable().transform(v => v || null)
const optNumber = () =>
  z.union([z.string(), z.number(), z.null(), z.undefined()])
   .transform(v => {
     if (v === null || v === undefined || v === '') return null
     const n = typeof v === 'number' ? v : parseFloat(v)
     return Number.isFinite(n) ? n : null
   })

const schema = z.object({
  full_name: z.string().min(1, 'Required'),
  display_name: optString(),
  phone: optString(),
  date_of_birth: optString(),
  nationality: optString(),
  id_number: optString(),
  emergency_contact_name: optString(),
  emergency_contact_phone: optString(),
  cert_agency: optString(),
  cert_level: optString(),
  cert_number: optString(),
  cert_date: optString(),
  medical_notes: optString(),
  // New (Phase 1) diver fields
  height_cm: optNumber(),
  weight_kg: optNumber(),
  shoe_size: optString(),
  gender: optString(),
  contact_method: z.preprocess(
    v => (v === '' || v === undefined ? null : v),
    z.enum(['whatsapp','line','phone','email']).nullable()
  ),
  contact_id: optString(),
  nitrox_certified: z.boolean().optional().transform(v => v ?? false),
  logged_dives: optNumber().transform(v => v ?? 0),
  last_dive_date: optString(),
})
type FormData = z.infer<typeof schema>

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
    await supabase.from('profiles').upsert({ id: user.id, ...data, updated_at: new Date().toISOString() })
    reset(data)
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-bold text-slate-100">My Profile</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Personal */}
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

        {/* Preferred contact */}
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

        {/* Sizing */}
        <section className="bg-slate-800 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-sky-400 uppercase tracking-wider">Sizing</h2>
          <Field label="Height (cm)"><input {...register('height_cm')} type="number" step="0.1" className={inputClass} /></Field>
          <Field label="Weight (kg)"><input {...register('weight_kg')} type="number" step="0.1" className={inputClass} /></Field>
          <Field label="Shoe size"><input {...register('shoe_size')} className={inputClass} placeholder="e.g. EU 41 / US 9" /></Field>
        </section>

        {/* Emergency */}
        <section className="bg-slate-800 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-sky-400 uppercase tracking-wider">Emergency Contact</h2>
          <Field label="Name"><input {...register('emergency_contact_name')} className={inputClass} /></Field>
          <Field label="Phone"><input {...register('emergency_contact_phone')} type="tel" className={inputClass} /></Field>
        </section>

        {/* Certification */}
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

        {/* Medical */}
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
