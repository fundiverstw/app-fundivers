import { createContext } from 'react'
import type { ShopProfile } from '../lib/shop-profile'

// Split from ShopProfileProvider.tsx for the reason auth-context.ts is split
// from AuthProvider.tsx: react-refresh's "only export components" rule trips
// when a context is exported beside a component from the same module.

export interface ShopProfileValue {
  profile: ShopProfile
  /** True until the first read lands. Consumers render the deployment's own
   *  config in the meantime, which is the same thing a shop that has set
   *  nothing sees — so there is no wrong intermediate state to flash. */
  loading: boolean
  /** Re-read after an admin edit, so the page they just saved is the page they
   *  see without a reload. */
  refresh: () => Promise<void>
}

export const ShopProfileContext = createContext<ShopProfileValue | null>(null)
