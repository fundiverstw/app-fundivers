import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { Markdown } from '../components/Markdown'
import { siteConfig } from '../config/site'
import { useTerms } from '../lib/use-terms'
import { termsTokenState, acceptTermsWithToken, type TermsTokenState } from '../lib/terms'
import { t } from '../i18n'

const at = t.acceptTerms

// Terms consent for a diver with no session.
//
// The walk-in whose account an admin minted has no password and no reason to
// get one, so RequireCurrentTerms — which only runs for signed-in users — never
// reaches them. This page is the other route: a one-time link from their email
// opens the shop's Terms and an "I agree" button, and the anon-callable
// accept_terms_with_token RPC records it.
//
// Public by design. Everything it needs is in the token, and neither RPC behind
// it returns anything about the diver, so a stranger with a guessed uuid learns
// nothing — not a name, not an email, not whether that account exists.

type Phase = TermsTokenState | 'loading' | 'accepted' | 'failed'

export function AcceptTermsPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const { terms, loading: termsLoading } = useTerms()
  const [phase, setPhase] = useState<Phase>('loading')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!token) { setPhase('unknown'); return }
      try {
        const state = await termsTokenState(token)
        if (!cancelled) setPhase(state)
      } catch {
        // A failed lookup must not present as a working link: better to send
        // them back to us than to have them tap Accept into a raw error.
        if (!cancelled) setPhase('failed')
      }
    })()
    return () => { cancelled = true }
  }, [token])

  async function onAccept() {
    setSubmitting(true)
    try {
      await acceptTermsWithToken(token)
      setPhase('accepted')
    } catch {
      // The RPC gives one message for unknown/used/expired on purpose, so we
      // don't echo it. Most likely the link was redeemed in another tab.
      setPhase('used')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-50 text-brand-900">
      <header className="bg-brand-950 border-b border-accent px-4 py-3">
        <Link to="/" aria-label={t.a11y.homeLink(siteConfig.identity.logoAlt)}><Logo size="sm" /></Link>
      </header>

      <main className="max-w-2xl mx-auto p-6 space-y-6 text-sm leading-relaxed">
        {phase === 'loading' || termsLoading ? (
          <p className="text-brand-950/70 italic">{at.checking}</p>
        ) : phase === 'accepted' ? (
          <Notice tone="ok" title={at.thanksTitle} body={at.thanksBody} />
        ) : phase === 'valid' ? (
          <>
            <Notice tone="ask" title={at.askTitle} body={at.askBody(siteConfig.identity.shopName)} />
            {/* The document itself, not a link to it: what they agree to has to
                be in front of them at the moment they agree. */}
            {terms?.body.trim()
              ? (
                <article className="space-y-4">
                  <h1 className="text-xl font-bold text-brand-900">{terms.title}</h1>
                  <Markdown source={terms.body} />
                </article>
              )
              : <p className="text-brand-950/70 italic">{t.terms.notPublished}</p>}
            <div className="pt-2">
              <button
                type="button"
                onClick={onAccept}
                disabled={submitting}
                className="px-4 py-2 rounded bg-brand-700 hover:bg-brand-800 disabled:bg-slate-400 text-white font-semibold"
              >
                {submitting ? t.terms.saving : at.agree}
              </button>
            </div>
          </>
        ) : phase === 'used' ? (
          <Notice tone="warn" title={at.usedTitle} body={at.usedBody} />
        ) : phase === 'expired' ? (
          <Notice tone="warn" title={at.expiredTitle} body={at.expiredBody(siteConfig.contact.email)} />
        ) : (
          <Notice tone="warn" title={at.unknownTitle} body={at.unknownBody(siteConfig.contact.email)} />
        )}

        <div className="text-center pt-6">
          <Link to="/terms" className="text-sm text-brand-700 hover:underline">{at.readTerms}</Link>
        </div>
      </main>
    </div>
  )
}

const TONE_CLASS = {
  ok:   'border-emerald-300 bg-emerald-50',
  ask:  'border-brand-300 bg-brand-50',
  warn: 'border-amber-300 bg-amber-50',
} as const

const TONE_TITLE_CLASS = {
  ok:   'text-emerald-900',
  ask:  'text-brand-900',
  warn: 'text-amber-900',
} as const

function Notice({ tone, title, body }: {
  tone: keyof typeof TONE_CLASS
  title: string
  body: string
}) {
  return (
    <section className={`rounded-lg border-2 p-4 space-y-2 ${TONE_CLASS[tone]}`}>
      <p className={`font-bold ${TONE_TITLE_CLASS[tone]}`}>{title}</p>
      <p className={TONE_TITLE_CLASS[tone]}>{body}</p>
    </section>
  )
}
