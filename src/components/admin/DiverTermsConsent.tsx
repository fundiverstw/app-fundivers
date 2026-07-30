import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import {
  fetchLatestTermsToken, sendTermsRequest, type TermsConsentToken,
} from '../../lib/terms'
import { useTerms } from '../../lib/use-terms'
import { errorMessage } from '../../lib/errors'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import type { Profile } from '../../types/database'
import { t } from '../../i18n'
import { BTN_XS_GHOST } from '../../styles/tokens'

const tc = t.admin.termsConsent

// Whether this diver has agreed to the shop's Terms, and a way to ask them.
//
// Three account paths record consent by themselves — self-signup and guest
// checkout both stamp it, and RequireCurrentTerms re-prompts a signed-in diver
// after a version bump. The fourth, an account an admin minted for a walk-in,
// records nothing and is never gated, because that diver has no password and no
// reason to get one. Until now nothing in the app showed that hole.
//
// The button emails the diver a one-time link (see AcceptTermsPage). It does NOT
// record consent: an admin asserting that someone agreed to a document they
// never saw would write a row that looks like consent and isn't, and would
// destroy what agreed_to_terms_version means to the route guard.
export function DiverTermsConsent({ user }: { user: Profile }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const { terms } = useTerms()
  const toast = useToast()
  const [latest, setLatest] = useState<TermsConsentToken | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    const row = await fetchLatestTermsToken(user.id)
    setLatest(row)
    setLoaded(true)
  }, [user.id])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await load()
      } catch {
        // The consent status below comes from the profile, which we already
        // have; only the "link sent" line is missing, so say nothing.
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [load])

  async function send() {
    setSending(true)
    try {
      await sendTermsRequest(user.id)
      await load()
      toast.success(tc.sent)
    } catch (err) {
      toast.error(tc.sendFailed(errorMessage(err)))
    } finally {
      setSending(false)
    }
  }

  const agreedVersion = user.agreed_to_terms_version ?? 0
  // Fail closed on an unknown live version: better to under-claim than to show
  // a green "current" we could not verify.
  const current = !!terms && agreedVersion >= terms.version
  const never = !user.agreed_to_terms_at

  const statusText = current
    ? tc.statusCurrent(agreedVersion, fmt(user.agreed_to_terms_at) ?? t.emails.common.dash)
    : never
      ? tc.statusNever
      : tc.statusStale(agreedVersion, terms?.version ?? agreedVersion)

  // Skipped rather than half-rendered when a timestamp won't parse: the status
  // above is the load-bearing part and comes straight off the profile.
  const linkText = !latest ? null
    : fmt(latest.used_at) ? tc.linkUsed(fmt(latest.used_at)!)
    : !fmt(latest.expires_at) ? null
    : new Date(latest.expires_at) < new Date() ? tc.linkExpired(fmt(latest.expires_at)!)
    : fmt(latest.created_at) ? tc.linkPending(fmt(latest.created_at)!, fmt(latest.expires_at)!)
    : null

  return (
    <div className="space-y-1 pt-1">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-brand-700 uppercase tracking-wider">
            {tc.title}
          </span>
          <span className={`block text-xs font-medium ${current ? 'text-emerald-700' : never ? 'text-red-600' : 'text-amber-700'}`}>
            {statusText}
          </span>
          {loaded && linkText && (
            <span className="block text-xs text-brand-950/70 font-medium">{linkText}</span>
          )}
        </span>
        {isAdmin && !current && (
          <button
            type="button"
            onClick={send}
            disabled={sending || !user.email}
            title={user.email ? undefined : tc.needsEmail}
            className={`${BTN_XS_GHOST} shrink-0 whitespace-nowrap`}
          >
            {sending ? tc.sending : latest ? tc.resend : tc.send}
          </button>
        )}
      </div>
    </div>
  )
}

// Null rather than a throw for anything unparseable. date-fns raises
// "Invalid time value" on a bad string, and one malformed timestamp must not
// take out the whole user card it is a single line of.
function fmt(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : format(d, 'MMM d, yyyy')
}
