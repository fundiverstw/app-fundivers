import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { CURRENT_TERMS_VERSION } from '../lib/terms-version'
import { siteConfig } from '../config/site'
import { TermsContent } from '../config/terms'

// Terms of Use + retention policy shown to divers at signup. Intentionally
// plain: a small shop + a small user base deserves a summary a normal person
// can read in 90 seconds. A proper lawyer pass is still recommended before
// going live in anything resembling production.
//
// Doubles as the re-acceptance surface (legal-brief #2 / route guard
// RequireCurrentTerms): when an authenticated user lands here with a
// stale agreed_to_terms_version, the ReacceptBanner at the top calls
// the accept_current_terms RPC and routes them back to /dashboard.

export function TermsPage() {
  return (
    <div className="min-h-screen bg-surface-50 text-brand-900">
      <header className="bg-brand-950 border-b border-accent px-4 py-3">
        <Link to="/" aria-label={`${siteConfig.identity.logoAlt} home`}><Logo size="sm" /></Link>
      </header>

      <main className="max-w-2xl mx-auto p-6 space-y-6 text-sm leading-relaxed">
        <ReacceptBanner />
        <TermsContent />

        <div className="text-center pt-6">
          <Link to="/" className="text-sm text-brand-700 hover:underline">‹ back</Link>
        </div>
      </main>
    </div>
  )
}

// Renders only when an authenticated user has a stale
// agreed_to_terms_version — either bounced here by RequireCurrentTerms
// or arriving via the ?reaccept=1 query param. Anonymous visitors and
// users already at CURRENT_TERMS_VERSION see nothing.
function ReacceptBanner() {
  const { profile, refreshProfile } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!profile) return null
  const stale = (profile.agreed_to_terms_version ?? 0) < CURRENT_TERMS_VERSION
  if (!stale && params.get('reaccept') !== '1') return null
  if (!stale) return null

  async function onAccept() {
    setSubmitting(true)
    setErr(null)
    const { error } = await supabase.rpc('accept_current_terms', { p_version: CURRENT_TERMS_VERSION })
    if (error) {
      setErr(error.message)
      setSubmitting(false)
      return
    }
    // Refresh the cached profile before navigating — otherwise
    // RequireCurrentTerms reads the stale agreed_to_terms_version and
    // bounces straight back here, trapping the user on the gate.
    await refreshProfile()
    navigate('/', { replace: true })
  }

  return (
    <section
      role="alert"
      className="rounded-lg border-2 border-accent bg-red-50 p-4 space-y-3"
    >
      <p className="font-bold text-red-700">Our Terms of Use have been updated</p>
      <p className="text-brand-950">
        Please read the updated terms below. You'll need to accept them to
        continue using the app.
      </p>
      <button
        type="button"
        onClick={onAccept}
        disabled={submitting}
        className="px-4 py-2 rounded bg-brand-700 hover:bg-brand-800 disabled:bg-slate-400 text-white font-semibold"
      >
        {submitting ? 'Saving…' : 'I agree to the updated Terms'}
      </button>
      {err && <p className="text-red-700 text-xs">{err}</p>}
    </section>
  )
}
