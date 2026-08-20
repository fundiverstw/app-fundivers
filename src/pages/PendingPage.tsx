import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { Logo } from '../components/Logo'
import { ProfileForm } from './ProfilePage'
import { profileGapLabels } from '../lib/profile-completeness'
import { CARD_ELEVATED, BTN_PRIMARY, TEXT_MUTED } from '../styles/tokens'
import { siteConfig } from '../config/site'
import { t } from '../i18n'

// Holding screen for pending / rejected divers. RequireActive routes
// every non-active diver here; the only way out is admin approval (then
// the next login takes them to /calendar) or signing out.
//
// Two states:
//   - rejected → static "not approved" message + sign out
//   - pending  → waiting-for-approval message, with the profile form below
//     so the diver can fill in as much as they feel like. An account is
//     complete the moment it exists: signing up costs an email and a
//     password, and nothing on this page gates the application. What is
//     still blank is shown as a nudge and reported to staff by
//     lib/profile-completeness.
export function PendingPage() {
  const { user, profile, signOut } = useAuth()
  const rejected = profile?.status === 'rejected'

  // The auth profile isn't refetched after a save, so the gap list goes
  // stale the moment the diver fills something in — stop showing it rather
  // than nag about a field they just completed.
  const [savedThisSession, setSavedThisSession] = useState(false)
  const gaps = profile && !savedThisSession ? profileGapLabels(profile) : []

  return (
    <div className="min-h-screen bg-brand-900 p-4">
      <div className="w-full max-w-lg mx-auto space-y-4">
        <div className="flex justify-center"><Logo size="lg" /></div>

        {rejected ? (
          <div className={`${CARD_ELEVATED} p-6 text-center`}>
            <h1 className="text-xl font-semibold text-brand-950 mb-2">
              {t.pending.rejectedTitle}
            </h1>
            <p className={`${TEXT_MUTED} text-sm mb-5`}>
              {t.pending.rejectedBodyPrefix}{' '}
              <a href={`mailto:${siteConfig.contact.email}`} className="underline">
                {siteConfig.contact.email}
              </a>{t.pending.rejectedBodySuffix}
            </p>
            <button onClick={signOut} className={`w-full ${BTN_PRIMARY}`}>
              {t.common.signOut}
            </button>
          </div>
        ) : (
          <>
            <div className={`${CARD_ELEVATED} p-4 text-center`}>
              <h1 className="text-lg font-semibold text-brand-950 mb-1">
                {t.pending.reviewTitle}
              </h1>
              <p className={`${TEXT_MUTED} text-xs`}>
                {t.pending.reviewBody}
              </p>
              {gaps.length > 0 && (
                <p className={`${TEXT_MUTED} text-xs mt-2`}>
                  {t.pending.stillMissing(gaps.join(', '))}
                </p>
              )}
            </div>

            {user && profile?.id && (
              <ProfileForm
                key={profile.id}
                user={user}
                profile={profile}
                onSaved={() => setSavedThisSession(true)}
              />
            )}

            <button onClick={signOut} className={`w-full ${BTN_PRIMARY}`}>
              {t.common.signOut}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
