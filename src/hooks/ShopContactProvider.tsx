import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchContactChannels, fetchShopContact, NO_SHOP_CONTACT } from '../lib/contact'
import { ShopContactContext } from './shop-contact-context'
import type { ContactChannel } from '../types/database'

// The shop's contact details, read once for the whole tree.
//
// They used to be config literals, which is to say free: every component that
// wanted the shop's email just imported it. Now they are two rows in the
// database, and a component-by-component fetch would mean the same two reads
// running four times on a page that mentions the address twice. One read at the
// top, like AuthProvider, and everything downstream is synchronous again.
//
// Deliberately NOT gating the app on the read: contact details are furniture on
// most screens, and a shop whose Supabase is slow should still get its bookings
// page. Consumers render the absent state until it lands, which is the same
// state a shop that has published nothing is in.

export function ShopContactProvider({ children }: { children: ReactNode }) {
  const [contact, setContact] = useState(NO_SHOP_CONTACT)
  const [channels, setChannels] = useState<ContactChannel[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const [details, list] = await Promise.all([fetchShopContact(), fetchContactChannels()])
    setContact(details)
    setChannels(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchShopContact(), fetchContactChannels()]).then(([details, list]) => {
      if (cancelled) return
      setContact(details)
      setChannels(list)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  return (
    <ShopContactContext.Provider value={{ contact, channels, loading, refresh }}>
      {children}
    </ShopContactContext.Provider>
  )
}
