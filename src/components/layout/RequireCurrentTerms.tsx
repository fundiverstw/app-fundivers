import { Link, Outlet, useLocation } from 'react-router-dom'
import { Spinner } from '../ui/Spinner'
import { useAuth } from '../../hooks/useAuth'
import { Logo } from '../Logo'
import { useTerms } from '../../lib/use-terms'
import { t } from '../../i18n'

// Terms re-acceptance for legal-brief item #2, as a banner rather than a wall.
//
// This used to <Navigate> every authenticated route to /terms?reaccept=1 the
// moment profiles.agreed_to_terms_version fell behind the shop's live
// terms.version. It worked, and divers hated it: a diver opening the app to
// check what time the boat leaves got a full-screen legal document instead,
// with no way past it and no sight of the thing they came for. A reworded
// paragraph and a suspended account looked identical from the outside.
//
// The prompt is now a bar across the top of every authenticated page, linking
// to the same /terms?reaccept=1 flow. It is not dismissible — it stays until
// the diver accepts, so the shop still gets its consent and still knows who
// has not given it — but nothing behind it is blocked in the meantime.
//
// Signup is unaffected: the /signup form takes consent to the current version
// before the account exists, so a new diver never sees this.
//
// The version comes from the DB, not a code constant. While it is unknown
// (still loading, or the read failed) we show nothing: a hiccup reading one row
// must not put a legal banner in front of every diver.

export function RequireCurrentTerms() {
  const { profile, loading } = useAuth()
  const { terms } = useTerms()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 gap-6">
        <Logo size="xl" />
        <Spinner className="w-8 h-8 border-4 border-surface-500" />
      </div>
    )
  }

  const stale =
    !!profile
    && !!terms
    && (profile.agreed_to_terms_version ?? 0) < terms.version
    // No banner on the page that resolves it — it would sit above the very
    // document it is asking the diver to read.
    && location.pathname !== '/terms'

  return (
    <>
      {stale && (
        <div className="bg-amber-100 border-b border-amber-300 px-4 py-2 text-center text-sm text-amber-900">
          {t.terms.bannerText}{' '}
          <Link to="/terms?reaccept=1" className="underline font-semibold">
            {t.terms.bannerAction}
          </Link>
        </div>
      )}
      <Outlet />
    </>
  )
}
