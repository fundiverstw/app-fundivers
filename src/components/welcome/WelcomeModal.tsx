import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { siteConfig } from '../../config/site'
import { t } from '../../i18n'

// One-time welcome popup for new divers — shown the first time they land in
// the AppShell after creating their account.
//
// Its job is to name the one next step. Signing up now costs a name, an email
// and a password, which means a brand-new account carries almost nothing the
// shop needs to put someone in the water: no certification, no sizing, no
// emergency contact. Nothing anywhere forces that gap closed — the profile
// form takes whatever it is given and the Save button no longer waits on a
// cert card — so this modal is where the diver is told the profile is the
// place to start, and handed a button that goes straight there.
//
// Deliberately not a wall: "Later" dismisses just as permanently as the
// primary button. A diver who wants to look at the calendar first is not
// doing anything wrong, and the 24-hour WelcomeBanner repeats the nudge.
//
// Persistence note: writing to user_metadata via auth.updateUser triggers an
// onAuthStateChange (USER_UPDATED) so useAuth picks up the new value without a
// page reload.
export function WelcomeModal({ user, onDismiss }: { user: User; onDismiss: () => void }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  async function dismiss(goToProfile: boolean) {
    setBusy(true)
    await supabase.auth.updateUser({ data: { welcomed_at: new Date().toISOString() } })
    setBusy(false)
    onDismiss()
    if (goToProfile) navigate('/profile')
  }

  const firstName = (user.user_metadata?.name as string | undefined)?.split(' ')[0]

  return (
    <div
      // Semi-transparent navy wash + blur → "looking through water" feel.
      className="fixed inset-0 bg-brand-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      role="dialog" aria-modal="true" aria-labelledby="welcome-title"
    >
      <div className="bg-white/75 backdrop-blur-md rounded-2xl max-w-md w-full p-6 space-y-4 border border-accent shadow-2xl">
        <div className="flex justify-center">
          <img src={siteConfig.assets.logo} alt={siteConfig.identity.logoAlt} className="w-32 h-auto" />
        </div>
        <h2 id="welcome-title" className="text-xl font-bold text-brand-900 text-center">
          {t.welcome.greeting(firstName ?? '')}
        </h2>
        <div className="text-sm text-brand-900 space-y-2">
          <p className="text-brand-950 font-semibold">
            {t.welcome.firstStep}
          </p>
          <p>
            {t.welcome.profileWhy(siteConfig.identity.shortName)}
          </p>
          <p>
            {t.welcome.profileNoRush}
          </p>
          <p className="text-brand-950 font-medium">
            {t.welcome.contactPrefix(siteConfig.identity.shortName)}{' '}
            <a href={`mailto:${siteConfig.contact.email}`} className="text-reef-300 underline hover:text-reef-200">{siteConfig.contact.email}</a>.
          </p>
        </div>
        <div className="space-y-2">
          <button
            onClick={() => dismiss(true)}
            disabled={busy}
            className="w-full bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white font-semibold py-2 rounded-lg transition-colors"
          >
            {busy ? '…' : t.welcome.fillProfile}
          </button>
          <button
            onClick={() => dismiss(false)}
            disabled={busy}
            className="w-full border border-brand-900 text-brand-900 hover:bg-surface-100 disabled:opacity-50 font-semibold py-2 rounded-lg transition-colors"
          >
            {t.welcome.later}
          </button>
        </div>
      </div>
    </div>
  )
}
