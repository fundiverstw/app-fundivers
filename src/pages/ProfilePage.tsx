import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

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
    if (profile) reset(profile as FormData)
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
          <Field label="Display name">
            <input {...register('display_name')} className={inputClass} />
          </Field>
          <Field label="Phone">
            <input {...register('phone')} type="tel" className={inputClass} />
          </Field>
          <Field label="Date of birth">
            <input {...register('date_of_birth')} type="date" className={inputClass} />
          </Field>
          <Field label="Nationality">
            <input {...register('nationality')} className={inputClass} />
          </Field>
          <Field label="ID / Passport number">
            <input {...register('id_number')} className={inputClass} />
          </Field>
        </section>

        {/* Emergency */}
        <section className="bg-slate-800 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-sky-400 uppercase tracking-wider">Emergency Contact</h2>
          <Field label="Name">
            <input {...register('emergency_contact_name')} className={inputClass} />
          </Field>
          <Field label="Phone">
            <input {...register('emergency_contact_phone')} type="tel" className={inputClass} />
          </Field>
        </section>

        {/* Certifications */}
        <section className="bg-slate-800 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-sky-400 uppercase tracking-wider">Certification</h2>
          <Field label="Agency (e.g. PADI, SSI)">
            <input {...register('cert_agency')} className={inputClass} />
          </Field>
          <Field label="Level (e.g. Open Water)">
            <input {...register('cert_level')} className={inputClass} />
          </Field>
          <Field label="Cert number">
            <input {...register('cert_number')} className={inputClass} />
          </Field>
          <Field label="Cert date">
            <input {...register('cert_date')} type="date" className={inputClass} />
          </Field>
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
