import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { siteConfig } from '../../config/site'
import { t } from '../../i18n'

// One-time welcome popup for new divers — shown the first time they
// land in the AppShell after creating their account. Dismissed by
// clicking the button, which stamps user_metadata.welcomed_at so the
// modal doesn't reappear on subsequent visits and so WelcomeBanner
// can show a 24-hour follow-up on the dashboard.
//
// Persistence note: writing to user_metadata via auth.updateUser
// triggers an onAuthStateChange (USER_UPDATED) so useAuth picks up
// the new value without a page reload.
export function WelcomeModal({ user, onDismiss }: { user: User; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false)

  async function dismiss() {
    setBusy(true)
    await supabase.auth.updateUser({ data: { welcomed_at: new Date().toISOString() } })
    setBusy(false)
    onDismiss()
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
          <p>
            {t.welcome.intro(siteConfig.identity.shortName)}
          </p>
          <ul className="list-disc list-inside text-brand-950 font-medium space-y-1">
            <li>{t.welcome.bullet1}</li>
            <li>{t.welcome.bullet2}</li>
            <li>{t.welcome.bullet3}</li>
          </ul>
          <p className="text-brand-950 font-medium">
            {t.welcome.contactPrefix(siteConfig.identity.shortName)}{' '}
            <a href={`mailto:${siteConfig.contact.email}`} className="text-brand-700 underline hover:text-brand-900">{siteConfig.contact.email}</a>.
          </p>
        </div>
        <button
          onClick={dismiss}
          disabled={busy}
          className="w-full bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white font-semibold py-2 rounded-lg transition-colors"
        >
          {busy ? '…' : t.welcome.getStarted}
        </button>
      </div>
    </div>
  )
}
