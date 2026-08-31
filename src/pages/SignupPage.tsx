import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { supabase } from '../lib/supabase'
import { invokeWithRetry } from '../lib/edge-invoke'
import { readSignupFailure } from '../lib/signup-errors'
import { Logo } from '../components/Logo'
import { PasswordInput } from '../components/PasswordInput'
import { TurnstileWidget } from '../components/register/TurnstileWidget'
import { useTerms } from '../lib/use-terms'
import { CARD_ELEVATED, INPUT, INPUT_LABEL, BTN_PRIMARY, TEXT_ERROR, TEXT_LINK, TEXT_MUTED } from '../styles/tokens'
import { t } from '../i18n'

// Signing up costs a name, an email address and a password.
//
// The name is the one that must match the diver's passport, because it is what
// goes on boat manifests and insurance paperwork and the shop cannot run a trip
// without it. Everything else the shop would like to know — certification,
// sizing, emergency contact, medical notes — is asked for later on /profile,
// where none of it blocks anything, and the details a specific trip genuinely
// cannot go without are collected at booking time by RegisterForm.
//
// What used to happen after this form, and no longer does: the new account sat
// at status='pending' behind RequireActive, and the diver was parked on
// /pending looking at the entire profile form and a "we're reviewing your
// application" banner until a human approved them. Accounts are active from the
// first insert now (20260831120000), so submitting this form lands the diver on
// the calendar.

const schema = z.object({
  name: z.string().trim().min(1, t.auth.nameRequired),
  email: z.string().email(t.auth.invalidEmail),
  password: z.string().min(8, t.auth.passwordMin),
  agreedToTerms: z.literal(true, { message: t.auth.agreeToContinue }),
})
type FormData = z.infer<typeof schema>

interface CreateAccountResponse {
  ok:      boolean
  user_id: string
  session: { access_token: string; refresh_token: string } | null
}

export function SignupPage() {
  const navigate = useNavigate()
  const { terms } = useTerms()
  const [serverError, setServerError] = useState('')
  // Set when the failure is specifically "that email is taken" — the useful
  // next step is a link to sign in, not a retry of the same form.
  const [emailTaken, setEmailTaken] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  // The challenge script never loaded. Distinct from "no token yet": that
  // resolves on its own, this never will.
  const [captchaDead, setCaptchaDead] = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '') as string

  // Stable identity so TurnstileWidget's effect doesn't tear down and re-render
  // the challenge on every keystroke in the form above it.
  const onToken = useCallback((token: string | null) => setTurnstileToken(token), [])
  const onCaptchaUnavailable = useCallback(() => setCaptchaDead(true), [])

  async function onSubmit(data: FormData) {
    setServerError('')
    setEmailTaken(false)

    // Account creation goes through the create-account edge function rather
    // than supabase.auth.signUp: the function verifies the Turnstile token
    // server-side, spends a per-IP budget before it will mint a user, and
    // creates the account with the address already confirmed — so there is no
    // "go and click the link in your email" step between here and diving.
    const { data: result, error } = await invokeWithRetry<CreateAccountResponse>('create-account', {
      body: {
        name:                    data.name.trim(),
        email:                   data.email.trim().toLowerCase(),
        password:                data.password,
        agreed_to_terms_at:      new Date().toISOString(),
        agreed_to_terms_version: terms?.version,
        turnstile_token:         turnstileToken,
      },
    })

    if (error) {
      const failure = await readSignupFailure(error, t.auth.signupFailed)
      setServerError(failure.message)
      setEmailTaken(failure.emailTaken)
      // The token is single-use — Cloudflare rejects a replay — so a retry
      // needs a fresh challenge.
      setTurnstileToken(null)
      return
    }

    if (result?.session) {
      await supabase.auth.setSession(result.session)
    } else {
      // The account exists but the function's courtesy sign-in didn't land.
      // The password is the one they just typed, so sign in from here rather
      // than reporting a failure over a working account.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email:    data.email.trim().toLowerCase(),
        password: data.password,
      })
      if (signInError) { navigate('/login', { replace: true }); return }
    }

    navigate('/calendar', { replace: true })
  }

  // Two ways the challenge can be impossible rather than merely pending: no
  // site key was built in, or its script could not be fetched. Either way no
  // token will ever arrive and every submit would be rejected server-side, so
  // say so and point at a human — rather than leaving a filled-in form behind
  // a button that never enables.
  const captchaUnavailable = !siteKey || captchaDead

  return (
    <div className="min-h-screen bg-brand-900 flex items-center justify-center p-4">
      <div className={`w-full max-w-sm ${CARD_ELEVATED} p-6`}>
        <div className="flex justify-center mb-3"><Logo size="lg" /></div>
        <p className={`${TEXT_MUTED} text-center mb-6 text-sm`}>{t.auth.createPrompt}</p>

        {captchaUnavailable ? (
          <p className={`${TEXT_ERROR} text-sm text-center`}>{t.auth.captchaUnavailable}</p>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className={INPUT_LABEL} htmlFor="signup-name">{t.auth.nameLabel}</label>
              <input
                id="signup-name"
                {...register('name')}
                autoComplete="name"
                className={INPUT}
              />
              <p className={`${TEXT_MUTED} text-xs mt-1`}>{t.auth.nameHint}</p>
              {errors.name && <p className={`${TEXT_ERROR} text-xs mt-1`}>{errors.name.message}</p>}
            </div>

            <div>
              <label className={INPUT_LABEL} htmlFor="signup-email">{t.auth.email}</label>
              <input
                id="signup-email"
                {...register('email')}
                type="email"
                autoComplete="email"
                className={INPUT}
              />
              {errors.email && <p className={`${TEXT_ERROR} text-xs mt-1`}>{errors.email.message}</p>}
            </div>

            <div>
              <label className={INPUT_LABEL} htmlFor="signup-password">{t.auth.password}</label>
              <PasswordInput
                id="signup-password"
                {...register('password')}
                autoComplete="new-password"
                className={INPUT}
              />
              {errors.password && <p className={`${TEXT_ERROR} text-xs mt-1`}>{errors.password.message}</p>}
            </div>

            <label className="flex items-start gap-2 text-xs text-brand-900">
              <input {...register('agreedToTerms')} type="checkbox" className="accent-brand-900 mt-0.5" />
              <span>
                {t.register.account.agreePrefix}{' '}
                <Link to="/terms" target="_blank" className={TEXT_LINK}>{t.register.account.termsLink}</Link>.
              </span>
            </label>
            {errors.agreedToTerms && <p className={`${TEXT_ERROR} text-xs`}>{errors.agreedToTerms.message}</p>}

            <div className="turnstile-fit">
              <TurnstileWidget siteKey={siteKey} onToken={onToken} onUnavailable={onCaptchaUnavailable} />
            </div>

            {serverError && (
              <p className={`${TEXT_ERROR} text-sm`}>
                {serverError}
                {emailTaken && (
                  <>
                    {' '}
                    <Link to="/login" className={TEXT_LINK}>{t.auth.emailTakenAction}</Link>
                  </>
                )}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !turnstileToken}
              className={`w-full ${BTN_PRIMARY}`}
            >
              {isSubmitting ? t.auth.creatingAccount : t.auth.createAccount}
            </button>

            {!turnstileToken && !serverError && (
              <p className={`${TEXT_MUTED} text-xs text-center`}>{t.auth.captchaPending}</p>
            )}

            <p className={`${TEXT_MUTED} text-xs text-center`}>{t.auth.profileLater}</p>
          </form>
        )}

        <p className={`text-center text-sm ${TEXT_MUTED} mt-6`}>
          {t.auth.alreadyHave}{' '}
          <Link to="/login" className={TEXT_LINK}>{t.auth.signIn}</Link>
        </p>
      </div>
    </div>
  )
}
