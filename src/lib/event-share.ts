import { siteConfig } from '../config/site'

// Share-link target for an event: the app's own registration page. /register/:id
// sits outside the auth gate (App.tsx), so a diver forwarding the link to a
// friend without an account sends them somewhere that renders the event and
// lets them sign up on the spot, rather than to a login wall.
export function eventShareUrl(id: string): string {
  return `${siteConfig.urls.app}/register/${encodeURIComponent(id)}`
}
