import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { supabase } from '../lib/supabase'

const schema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})
type FormData = z.infer<typeof schema>

const DEV_ACCOUNTS = [
  { label: 'diver@diver.diver', email: 'diver@diver.diver', password: 'diverdiver' },
  { label: 'admin@admin.admin', email: 'admin@admin.admin', password: 'adminadmin' },
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

    // Fetch role so admins land on /admin, divers on /calendar.
    let role: 'diver' | 'admin' = 'diver'
    if (signIn?.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', signIn.user.id)
        .single()
      if (profile?.role === 'admin') role = 'admin'
    }
    navigate(role === 'admin' ? '/admin' : '/calendar')
  }

  function fill(account: typeof DEV_ACCOUNTS[number]) {
    setValue('email', account.email)
    setValue('password', account.password)
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-bold text-sky-400 text-center mb-2">FunDivers TW</h1>
        <p className="text-slate-400 text-center mb-8 text-sm">Sign in to your account</p>

        {import.meta.env.DEV && (
          <div className="grid grid-cols-2 gap-2 mb-4">
            {DEV_ACCOUNTS.map(acc => (
              <button
                key={acc.email}
                type="button"
                onClick={() => fill(acc)}
                className="border border-dashed border-slate-600 text-slate-400 text-xs py-1.5 rounded-lg hover:border-slate-400 hover:text-slate-200 transition-colors"
              >
                {acc.label}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Email</label>
            <input
              {...register('email')}
              type="email"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-sky-500"
            />
            {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email.message}</p>}
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Password</label>
            <input
              {...register('password')}
              type="password"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-sky-500"
            />
            {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password.message}</p>}
          </div>

          {serverError && <p className="text-red-400 text-sm">{serverError}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-semibold py-2 rounded-lg transition-colors"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm text-slate-400 mt-6">
          No account?{' '}
          <Link to="/signup" className="text-sky-400 hover:underline">Sign up</Link>
        </p>
      </div>
    </div>
  )
}
