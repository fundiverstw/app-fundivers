import { useContext } from 'react'
import { ShopContactContext, type ShopContactValue } from './shop-contact-context'
import { NO_SHOP_CONTACT } from '../lib/contact'

/**
 * The shop's contact details and its contact buttons.
 *
 * Falls back to the empty details outside a provider rather than throwing, the
 * opposite of `useAuth`. Auth outside its provider is a bug that must be loud;
 * contact details outside theirs is a screen with no phone number on it, and
 * failing to render a booking page over a missing address would be the worse
 * outcome of the two.
 */
export function useShopContact(): ShopContactValue {
  const ctx = useContext(ShopContactContext)
  if (ctx) return ctx
  return { contact: NO_SHOP_CONTACT, channels: [], loading: false, refresh: async () => {} }
}
