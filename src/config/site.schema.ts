import { z } from 'zod'
import { CONFIG_CONTRACT_VERSION, type SiteConfig } from './site'

// Runtime validation of a fork's fundive.config.ts. Kept separate from site.ts
// (which stays dependency-free so the pure config file's import graph never pulls
// in zod) and used by two places only: src/config/site.test.ts and the vite build
// guard. `z.infer` is asserted to equal SiteConfig so the schema and the type
// can't silently drift.

const url = z.string().regex(/^https?:\/\//, 'must be an absolute http(s) URL')

export const siteConfigSchema = z.object({
  configVersion: z.number().int().positive(),
  identity: z.object({
    tagline: z.string(),
    appName: z.string().min(1),
    shopName: z.string().min(1),
    shortName: z.string().min(1),
    description: z.string().min(1),
    logoAlt: z.string().min(1),
  }),
  contact: z.object({
    email: z.string().regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'must be an email'),
    phone: z.string().min(1),
    address: z.string().min(1),
    mapsUrl: url,
    lineUrl: url,
    whatsappUrl: url,
    paypalLink: url,
  }),
  urls: z.object({
    site: url,
    app: url,
    eventPage: url.nullable(),
  }),
  locale: z.object({
    timezone: z.string().min(1),
    currency: z.string().min(1),
    currencyLabel: z.string().min(1),
    language: z.enum(['en', 'zh-TW', 'ja']),
  }),
  theme: z.object({
    themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb hex color'),
    backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb hex color'),
  }),
  assets: z.object({
    logo: z.string().min(1),
    favicon: z.string().min(1),
    icon192: z.string().min(1),
    icon512: z.string().min(1),
    appleTouchIcon: z.string().min(1),
  }),
  features: z.object({
    push: z.boolean(),
    broadcast: z.boolean(),
    eventSharing: z.boolean(),
  }),
  business: z.object({
    gearItems: z.array(z.string().min(1)).min(1),
    gearPrices: z.record(z.string(), z.number().nonnegative()),
    paymentDeadlineFallbackDays: z.number().int().positive(),
    cardSurchargePercent: z.number().nonnegative(),
    nitroxCourseFee: z.number().nonnegative(),
    tripKeywords: z.array(z.string().min(1)),
    boatManifest: z.object({
      boatName: z.string(),
      registration: z.string(),
      notes: z.array(z.string().min(1)),
    }),
  }),
  weatherRegion: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    label: z.string().min(1),
  }),
})

// Compile-time proof the schema matches the hand-written SiteConfig type.
type SchemaShape = z.infer<typeof siteConfigSchema>
const _typeCheck: (a: SchemaShape) => SiteConfig = a => a
void _typeCheck

/**
 * Validate a config object and additionally assert its declared configVersion is
 * current. Throws a readable error listing every problem. Used by the vite build
 * guard and the config test.
 */
export function assertValidSiteConfig(config: unknown): void {
  const parsed = siteConfigSchema.safeParse(config)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(i => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid fundive.config.ts:\n${issues}`)
  }
  if (parsed.data.configVersion < CONFIG_CONTRACT_VERSION) {
    throw new Error(
      `fundive.config.ts is configVersion ${parsed.data.configVersion} but core ` +
        `requires ${CONFIG_CONTRACT_VERSION}. Migrate your config to the current ` +
        'contract (see CHANGELOG.md) and bump configVersion.',
    )
  }
}
