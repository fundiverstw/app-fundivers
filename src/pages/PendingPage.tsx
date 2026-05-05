import { useAuth } from '../hooks/useAuth'
import { Logo } from '../components/Logo'
import { ProfileForm } from './ProfilePage'
import { CARD_ELEVATED, BTN_PRIMARY, TEXT_MUTED } from '../styles/tokens'

// Holding screen for pending / rejected divers. RequireActive routes
// every non-active diver here; the only way out is admin approval (then
// the next login takes them to /calendar) or signing out.
//
// Pending divers see the profile form so they can submit the data the
// admin needs to approve them — the static "you're under review" copy
// alone left admins with empty applications to review.
export function PendingPage() {
  const { user, profile, signOut } = useAuth()
  const rejected = profile?.status === 'rejected'

  return (
    <div className="min-h-screen bg-blue-900 p-4">
      <div className="w-full max-w-lg mx-auto space-y-4">
        <div className="flex justify-center"><Logo size="lg" /></div>

        {rejected ? (
          <div className={`${CARD_ELEVATED} p-6 text-center`}>
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
            <button onClick={signOut} className={`w-full ${BTN_PRIMARY}`}>
              Sign out
            </button>
          </div>
        ) : (
          <>
            <div className={`${CARD_ELEVATED} p-4 text-center`}>
              <h1 className="text-lg font-semibold text-blue-950 mb-1">
                Application under review
              </h1>
              <p className={`${TEXT_MUTED} text-xs`}>
                Fill in the required fields below and save — an admin will
                review your application and you'll receive an email once
                you're approved.
              </p>
            </div>

            {user && profile?.id && (
              <ProfileForm key={profile.id} user={user} profile={profile} />
            )}

            <button onClick={signOut} className={`w-full ${BTN_PRIMARY}`}>
              Sign out
            </button>
          </>
        )}
      </div>
    </div>
  )
}
