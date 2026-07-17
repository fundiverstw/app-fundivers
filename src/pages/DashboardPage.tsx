import { useAuth } from '../hooks/useAuth'
import { FeaturedEvents } from '../components/dashboard/FeaturedEvents'
import { WelcomeBanner } from '../components/welcome/WelcomeBanner'
import { t } from '../i18n'

// Diver + admin landing. The container is transparent so the fixed deep-ocean
// body gradient (src/index.css) shows through. The welcome banner and featured
// trips sit in a centered column pinned to the TOP (so Featured Trips never slip
// behind the fixed bottom nav), and the version / beta badge floats in the
// bottom-right corner above the nav.
export function DashboardPage() {
  const { user } = useAuth()

  return (
    <div className="relative -m-4 -mb-24 min-h-[calc(100vh-3rem)] overflow-hidden">
      <div className="relative z-10 mx-auto flex w-full max-w-md flex-col gap-4 px-4 pt-6 pb-28">
        {user && <WelcomeBanner user={user} />}
        <FeaturedEvents />
      </div>

      {/* Powered-by mark — bottom-right, clear of the bottom nav, on one row: the
          light-ink fundive logo (links to the open-source org) beside the version
          chip (links to that release's notes). */}
      <div className="fixed bottom-20 right-4 z-40 flex items-center gap-2">
        <a
          href="https://github.com/fundive"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t.dashboard.poweredByGithub}
          className="opacity-80 transition-opacity hover:opacity-100"
        >
          <img src="/fundive-logo-light.svg" alt="fundive" className="h-14 w-auto drop-shadow-lg" />
        </a>
        <a
          href="https://github.com/fundive/fundive/releases/tag/v0.0.1"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t.dashboard.releaseNotes('v0.0.1')}
          className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-white shadow transition-colors hover:bg-red-400"
        >
          v0.0.1
        </a>
      </div>
    </div>
  )
}
