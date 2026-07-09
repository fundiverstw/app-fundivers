import { useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { siteConfig } from '../../config/site'
import { t } from '../../i18n'

// 24-hour follow-up to the WelcomeModal. Once the modal is dismissed
// (welcomed_at stamped), this banner shows on the dashboard for the
// next day so divers have a softer reminder of where to go without
// the modal blocking the screen.
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export function WelcomeBanner({ user }: { user: User }) {
  // Decision captured once at mount — avoids reading Date.now() in the
  // render body (react-hooks/purity) and it's fine if the banner
  // doesn't live-disappear the moment the 24h mark passes; it'll be
  // gone on the next navigation / reload.
  const [shouldShow] = useState(() => {
    const raw = user.user_metadata?.welcomed_at as string | undefined
    if (!raw) return false
    const welcomedAt = Date.parse(raw)
    if (!Number.isFinite(welcomedAt)) return false
    return Date.now() - welcomedAt <= TWENTY_FOUR_HOURS_MS
  })
  if (!shouldShow) return null

  return (
    <div className="glass glow-teal rounded-2xl p-4 flex items-center gap-3 shadow-lg">
      <img src={siteConfig.assets.logo} alt="" aria-hidden="true" className="w-12 h-auto shrink-0" />
      <div className="text-sm text-brand-50">
        <p className="font-semibold text-white">{t.welcome.bannerTitle(siteConfig.identity.shortName)}</p>
        <p className="text-brand-100/80 font-medium text-xs mt-0.5">
          {t.welcome.bannerBody}
        </p>
      </div>
    </div>
  )
}
