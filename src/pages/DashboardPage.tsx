import { useAuth } from '../hooks/useAuth'
import { Caustics } from '../components/dashboard/Caustics'
import { FeaturedEvents } from '../components/dashboard/FeaturedEvents'
import { WelcomeBanner } from '../components/welcome/WelcomeBanner'

// Diver + admin landing. The container is transparent so the fixed deep-ocean
// body gradient (src/index.css) shows through, with the animated water caustics
// drifting over it — the same ambient background as the marketing site. The
// welcome banner and featured trips float above as glass panels.
export function DashboardPage() {
  const { user } = useAuth()

  return (
    <div className="relative -m-4 -mb-24 h-[calc(100vh-3rem)] overflow-hidden">
      <Caustics />
      {user && (
        <div className="absolute top-4 right-4 left-auto max-w-sm z-10">
          <WelcomeBanner user={user} />
        </div>
      )}
      <FeaturedEvents />
    </div>
  )
}
