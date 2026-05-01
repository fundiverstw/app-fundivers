import { useAuth } from '../hooks/useAuth'
import { Logo } from '../components/Logo'
import { CARD_ELEVATED, BTN_PRIMARY, TEXT_MUTED } from '../styles/tokens'

// Holding screen for pending / rejected divers. RequireActive routes
// every non-active diver here; the only way out is admin approval (then
// the next login takes them to /calendar) or signing out.
export function PendingPage() {
  const { profile, signOut } = useAuth()
  const rejected = profile?.status === 'rejected'

  return (
    <div className="min-h-screen bg-blue-900 flex items-center justify-center p-4">
      <div className={`w-full max-w-sm ${CARD_ELEVATED} p-6 text-center`}>
        <div className="flex justify-center mb-4"><Logo size="lg" /></div>

        {rejected ? (
          <>
            <h1 className="text-xl font-semibold text-blue-950 mb-2">
              Application not approved
            </h1>
            <p className={`${TEXT_MUTED} text-sm mb-5`}>
              Your application was reviewed and not approved at this time. If
              you believe this is a mistake, please contact us at{' '}
              <a href="mailto:fundiverstw@gmail.com" className="underline">
                fundiverstw@gmail.com
              </a>.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-blue-950 mb-2">
              Application under review
            </h1>
            <p className={`${TEXT_MUTED} text-sm mb-5`}>
              Thanks for registering. An admin will review your application
              shortly — you'll receive an email once your account is approved.
            </p>
          </>
        )}

        <button onClick={signOut} className={`w-full ${BTN_PRIMARY}`}>
          Sign out
        </button>
      </div>
    </div>
  )
}
