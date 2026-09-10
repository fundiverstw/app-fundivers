import { siteConfig } from '../config/site'
import { useShopProfile } from '../hooks/useShopProfile'
import { logoUrlOf } from '../lib/shop-profile'

// Brand logo — the shop's uploaded mark when it has one (Manage → Shop
// Profile), otherwise the one the build ships (`assets.logo`). Size presets so
// every surface that uses it picks a consistent height. A transparent
// background is what makes one image work on both the dark and light surfaces.
//
// Sizes (height in px): xs 24, sm 36, md 56, lg 88, xl 128.

const SIZE_CLASS: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', string> = {
  xs: 'h-6',
  sm: 'h-9',
  md: 'h-14',
  lg: 'h-22',
  xl: 'h-32',
}

export function Logo({
  size = 'md',
  className = '',
}: {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  const { profile } = useShopProfile()
  return (
    <img
      src={logoUrlOf(profile)}
      alt={siteConfig.identity.logoAlt}
      className={`${SIZE_CLASS[size]} w-auto ${className}`}
    />
  )
}
