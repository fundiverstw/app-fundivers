import { createContext } from 'react'
import type { ShopContactDetails } from '../lib/contact'
import type { ContactChannel } from '../types/database'

// Split from ShopContactProvider.tsx for the reason auth-context.ts is split
// from AuthProvider.tsx: react-refresh's "only export components" rule trips
// when a context is exported beside a component from the same module.

export interface ShopContactValue {
  contact: ShopContactDetails
  /** Active channels, in the shop's own order. */
  channels: ContactChannel[]
  /** True until the first read lands. The details render as absent rather than
   *  as stale, so a caller that cares can wait instead of flashing an empty
   *  address into a sentence. */
  loading: boolean
  /** Re-read after an admin edit, so the page they just saved is the page they
   *  see without a reload. */
  refresh: () => Promise<void>
}

export const ShopContactContext = createContext<ShopContactValue | null>(null)
