import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { supabase } from '../lib/supabase'
import { Logo } from '../components/Logo'
import { PasswordInput } from '../components/PasswordInput'
import { CARD_ELEVATED, INPUT, INPUT_LABEL, BTN_PRIMARY, TEXT_ERROR, TEXT_LINK, TEXT_MUTED } from '../styles/tokens'

const schema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})
type FormData = z.infer<typeof schema>

// Seeded by supabase/seed-local-test-users.sql on every `make reset`. Keep
// the credentials here in sync with that file's password values.
const DEV_ACCOUNTS = [
  { label: 'diver@diver.diver', email: 'diver@diver.diver', password: 'diverdiver' },
  { label: 'admin@admin.admin', email: 'admin@admin.admin', password: 'adminadmin' },
  { label: 'staff@staff.staff', email: 'staff@staff.staff', password: 'staffstaff' },
] as const

export function LoginPage() {
  const navigate = useNavigate()
  const [serverError, setServerError] = useState('')
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setServerError('')
    const { data: signIn, error } = await supabase.auth.signInWithPassword(data)
    if (error) { setServerError(error.message); return }

    // Fetch role + status. Admins land on /admin; staff on /admin/events;
    // pending / rejected divers on /pending; everyone else on /calendar.
    // Staff and admin bypass the status gate so a non-active staff/admin
    // (data-fix gone wrong) can still operate.
    let role:   'diver' | 'admin' | 'staff' = 'diver'
    let status: 'pending' | 'active' | 'rejected' = 'active'
    if (signIn?.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, status')
        .eq('id', signIn.user.id)
        .single()
      if (profile?.role === 'admin' || profile?.role === 'staff') role = profile.role
      if (profile?.status) status = profile.status
    }
    if (role === 'diver' && status !== 'active') navigate('/pending')
    else navigate(role === 'admin' ? '/admin' : role === 'staff' ? '/admin/events' : '/calendar')
  }

  function fill(account: typeof DEV_ACCOUNTS[number]) {
    setValue('email', account.email)
    setValue('password', account.password)
  }

  return (
    <div className="min-h-screen bg-brand-900 flex items-center justify-center p-4">
      <div className={`w-full max-w-sm ${CARD_ELEVATED} p-6`}>
        <div className="flex justify-center mb-3"><Logo size="lg" /></div>
        <p className={`${TEXT_MUTED} text-center mb-8 text-sm`}>Sign in to your account</p>

        {import.meta.env.DEV && (
          <div className="grid grid-cols-2 gap-2 mb-4">
            {DEV_ACCOUNTS.map(acc => (
              <button
                key={acc.email}
                type="button"
                onClick={() => fill(acc)}
                className={`border border-dashed border-brand-900/40 ${TEXT_MUTED} text-xs py-1.5 rounded-lg hover:border-brand-900 hover:text-brand-900 transition-colors`}
              >
                {acc.label}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className={INPUT_LABEL}>Email</label>
            <input {...register('email')} type="email" className={INPUT} />
            {errors.email && <p className={`${TEXT_ERROR} text-xs mt-1`}>{errors.email.message}</p>}
          </div>

          <div>
            <label className={INPUT_LABEL}>Password</label>
            <PasswordInput {...register('password')} className={INPUT} />
            {errors.password && <p className={`${TEXT_ERROR} text-xs mt-1`}>{errors.password.message}</p>}
          </div>

          {serverError && <p className={`${TEXT_ERROR} text-sm`}>{serverError}</p>}

          <button type="submit" disabled={isSubmitting} className={`w-full ${BTN_PRIMARY}`}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className={`text-center text-sm ${TEXT_MUTED} mt-3`}>
          <Link to="/forgot-password" className={TEXT_LINK}>Forgot password?</Link>
        </p>

        <p className={`text-center text-sm ${TEXT_MUTED} mt-6`}>
          No account?{' '}
          <Link to="/signup" className={TEXT_LINK}>Sign up</Link>
        </p>
      </div>
    </div>
  )
}
