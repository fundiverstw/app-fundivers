import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { useAuth } from '../hooks/useAuth'
import { siteConfig } from '../config/site'
import { Markdown } from '../components/Markdown'
import { acceptCurrentTerms } from '../lib/terms'
import { useTerms } from '../lib/use-terms'
import { errorMessage } from '../lib/errors'
import { t } from '../i18n'

// The shop's Terms of Use, authored in admin -> Manage and stored in the DB
// (migration 20260711100000). Rendered as a Markdown subset — never as HTML.
//
// Doubles as the re-acceptance surface (legal-brief #2 / route guard
// RequireCurrentTerms): when an authenticated user lands here with an
// agreed_to_terms_version below the live terms.version, the ReacceptBanner at
// the top calls the accept_current_terms RPC and routes them back to /dashboard.

export function TermsPage() {
  return (
    <div className="min-h-screen bg-surface-50 text-brand-900">
      <header className="bg-brand-950 border-b border-accent px-4 py-3">
        <Link to="/" aria-label={t.a11y.homeLink(siteConfig.identity.logoAlt)}><Logo size="sm" /></Link>
      </header>

      <main className="max-w-2xl mx-auto p-6 space-y-6 text-sm leading-relaxed">
        <ReacceptBanner />
        <TermsBody />

        <div className="text-center pt-6">
          <Link to="/" className="text-sm text-brand-700 hover:underline">{t.terms.back}</Link>
        </div>
      </main>
    </div>
  )
}

// The shop's document. Empty until an admin writes one — a fresh install must
// show nothing rather than another shop's legal text.
function TermsBody() {
  const { terms, loading } = useTerms()
  if (loading) return null
  if (!terms?.body.trim()) return <p className="text-brand-950/70 italic">{t.terms.notPublished}</p>
  return (
    <article className="space-y-4">
      <h1 className="text-xl font-bold text-brand-900">{terms.title}</h1>
      <Markdown source={terms.body} />
    </article>
  )
}

// Renders only when an authenticated user has an agreed_to_terms_version below
// the live terms.version — either bounced here by RequireCurrentTerms or
// arriving via the ?reaccept=1 query param. Anonymous visitors and up-to-date
// users see nothing.
function ReacceptBanner() {
  const { profile, refreshProfile } = useAuth()
  const { terms } = useTerms()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!profile || !terms) return null
  const stale = (profile.agreed_to_terms_version ?? 0) < terms.version
  if (!stale && params.get('reaccept') !== '1') return null
  if (!stale) return null

  async function onAccept() {
    setSubmitting(true)
    setErr(null)
    try {
      await acceptCurrentTerms()
    } catch (e) {
      setErr(errorMessage(e))
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
      <p className="font-bold text-red-700">{t.terms.updatedTitle}</p>
      <p className="text-brand-950">{t.terms.updatedBody}</p>
      <button
        type="button"
        onClick={onAccept}
        disabled={submitting}
        className="px-4 py-2 rounded bg-brand-700 hover:bg-brand-800 disabled:bg-slate-400 text-white font-semibold"
      >
        {submitting ? t.terms.saving : t.terms.agreeUpdated}
      </button>
      {err && <p className="text-red-700 text-xs">{err}</p>}
    </section>
  )
}
