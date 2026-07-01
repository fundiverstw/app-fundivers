import { usePWAUpdate } from '../../hooks/usePWAUpdate'
import { UpdateAvailableBanner } from './UpdateAvailableBanner'

// Mounted once at the App root so the update banner appears on every
// route — including auth pages and the public registration flow, which
// don't live inside AppShell/AdminShell.
// usePWAUpdate registers the service worker the first time it runs;
// keeping a single host means we register exactly once.
export function UpdateBannerHost() {
  const { needRefresh, update } = usePWAUpdate()
  if (!needRefresh) return null
  return <UpdateAvailableBanner onUpdate={update} />
}
