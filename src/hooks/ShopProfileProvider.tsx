import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchShopProfile, NO_SHOP_PROFILE } from '../lib/shop-profile'
import { ShopProfileContext } from './shop-profile-context'

// The shop's logo and training agency, read once for the whole tree.
//
// Same shape and the same reasoning as ShopContactProvider: one read at the
// top rather than a fetch per component, and deliberately not gating the app on
// it. A shop whose Supabase is slow should still get its bookings page; until
// the row lands, every consumer renders what the deployment's own config says,
// which is exactly what a shop that has uploaded no logo sees anyway.

export function ShopProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState(NO_SHOP_PROFILE)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setProfile(await fetchShopProfile())
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchShopProfile().then(row => {
      if (cancelled) return
      setProfile(row)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  return (
    <ShopProfileContext.Provider value={{ profile, loading, refresh }}>
      {children}
    </ShopProfileContext.Provider>
  )
}
