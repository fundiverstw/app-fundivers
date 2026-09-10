import { useContext } from 'react'
import { ShopProfileContext, type ShopProfileValue } from './shop-profile-context'
import { NO_SHOP_PROFILE } from '../lib/shop-profile'

/**
 * The shop's logo, training agency, currency and language.
 *
 * Falls back to the empty profile outside a provider rather than throwing, for
 * the reason useShopContact does: every consumer already renders the
 * deployment's own config when the shop has set nothing, so the absent case is
 * a supported state rather than a bug to make loud.
 */
export function useShopProfile(): ShopProfileValue {
  const ctx = useContext(ShopProfileContext)
  if (ctx) return ctx
  return { profile: NO_SHOP_PROFILE, loading: false, refresh: async () => {} }
}
