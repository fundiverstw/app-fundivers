import { useAuth } from '../hooks/useAuth'
import { Caustics } from '../components/dashboard/Caustics'
import { FeaturedEvents } from '../components/dashboard/FeaturedEvents'
import { WelcomeBanner } from '../components/welcome/WelcomeBanner'

// Diver + admin landing. The container is transparent so the fixed deep-ocean
// body gradient (src/index.css) shows through, with the animated water caustics
// drifting over it — the same ambient background as the marketing site. The
// welcome banner and featured trips sit in a centered column pinned to the TOP
// (so Featured Trips never slip behind the fixed bottom nav), and the version /
// beta badge floats in the bottom-right corner above the nav.
export function DashboardPage() {
  const { user } = useAuth()

  return (
    <div className="relative -m-4 -mb-24 min-h-[calc(100vh-3rem)] overflow-hidden">
      <Caustics />

      <div className="relative z-10 mx-auto flex w-full max-w-md flex-col gap-4 px-4 pt-6 pb-28">
        {user && <WelcomeBanner user={user} />}
        <FeaturedEvents />
      </div>

      {/* Powered-by mark — bottom-right, clear of the bottom nav. The whole
          fundive logo links to the open-source project on GitHub, with the
          version / "beta" tag on its bottom-right corner. The light-ink variant
          reads on the dark ocean background. */}
      <a
        href="https://github.com/fundive"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Built with fundive — view on GitHub"
        className="group fixed bottom-20 right-4 z-40 transition-opacity hover:opacity-100 opacity-80"
      >
        <span className="relative inline-block">
          <img src="/fundive-logo-light.svg" alt="fundive" className="h-7 w-auto drop-shadow-lg" />
          <span className="absolute -bottom-2 -right-1 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-white shadow">
            beta
          </span>
        </span>
      </a>
    </div>
  )
}
