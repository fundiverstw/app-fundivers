import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { supabase } from '../lib/supabase'
import { Logo } from '../components/Logo'
import { CARD_ELEVATED, INPUT, INPUT_LABEL, BTN_PRIMARY, TEXT_ERROR, TEXT_LINK, TEXT_MUTED } from '../styles/tokens'

const schema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirm: z.string(),
  agreedToTerms: z.literal(true, { message: 'Please agree to continue' }),
}).refine(d => d.password === d.confirm, { message: 'Passwords do not match', path: ['confirm'] })
type FormData = z.infer<typeof schema>

export function SignupPage() {
  const [done, setDone] = useState(false)
  const [serverError, setServerError] = useState('')
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setServerError('')
    // Stash the agreement timestamp on auth.users.raw_user_meta_data; the
    // handle_new_user trigger copies it into profiles.agreed_to_terms_at
    // when the account row is created.
    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: { data: { agreed_to_terms_at: new Date().toISOString() } },
    })
    if (error) { setServerError(error.message); return }
    setDone(true)
  }

  if (done) {
    return (
      <div className="min-h-screen bg-blue-900 flex items-center justify-center p-4">
        <div className={`w-full max-w-sm ${CARD_ELEVATED} p-6 text-center`}>
          <h2 className="text-xl font-semibold text-blue-950 mb-2">Account created</h2>
          <p className={`${TEXT_MUTED} text-sm`}>
            Fill in your profile so an admin can review your application —
            you'll be taken there in a moment.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-blue-900 flex items-center justify-center p-4">
      <div className={`w-full max-w-sm ${CARD_ELEVATED} p-6`}>
        <div className="flex justify-center mb-3"><Logo size="lg" /></div>
        <p className={`${TEXT_MUTED} text-center mb-8 text-sm`}>Create your account</p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className={INPUT_LABEL}>Email</label>
            <input {...register('email')} type="email" className={INPUT} />
            {errors.email && <p className={`${TEXT_ERROR} text-xs mt-1`}>{errors.email.message}</p>}
          </div>

          <div>
            <label className={INPUT_LABEL}>Password</label>
            <input {...register('password')} type="password" className={INPUT} />
            {errors.password && <p className={`${TEXT_ERROR} text-xs mt-1`}>{errors.password.message}</p>}
          </div>

          <div>
            <label className={INPUT_LABEL}>Confirm password</label>
            <input {...register('confirm')} type="password" className={INPUT} />
            {errors.confirm && <p className={`${TEXT_ERROR} text-xs mt-1`}>{errors.confirm.message}</p>}
          </div>

          <label className="flex items-start gap-2 text-xs text-blue-900">
            <input {...register('agreedToTerms')} type="checkbox" className="accent-blue-900 mt-0.5" />
            <span>
              I agree to the{' '}
              <Link to="/terms" target="_blank" className={TEXT_LINK}>Terms of Use & Privacy</Link>.
            </span>
          </label>
          {errors.agreedToTerms && <p className={`${TEXT_ERROR} text-xs`}>{errors.agreedToTerms.message}</p>}

          {serverError && <p className={`${TEXT_ERROR} text-sm`}>{serverError}</p>}

          <button type="submit" disabled={isSubmitting} className={`w-full ${BTN_PRIMARY}`}>
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className={`text-center text-sm ${TEXT_MUTED} mt-6`}>
          Already have an account?{' '}
          <Link to="/login" className={TEXT_LINK}>Sign in</Link>
        </p>
      </div>
    </div>
  )
}
