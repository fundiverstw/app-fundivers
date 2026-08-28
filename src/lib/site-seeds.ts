import type { DiveSiteMap } from './dive-site-map'

// The sites the shop dives, as empty maps waiting to be filled in.
//
// A seed carries identity and an extent, and nothing else. No depths, no
// features, nothing traced from anyone's drawing. Everything on a site map here
// is meant to have been contributed by somebody who was in the water, with
// their name and the time attached.
//
// The editing lattice is not stored — see `LATTICE_SPACING_M` in
// dive-site-map.ts. A diver corrects a 1 m position and a record appears; until
// then the position costs nothing.
//
// `frame.origin` is deliberately absent. Placing a site on Earth needs a
// surveyed origin — a GPS fix on a known feature, not a guess off a satellite
// image — and the model is explicit that a map without one is still usable:
// contributions are positioned relative to each other until then.

/**
 * Half-width of a new site's canvas, in meters — a 500 m square.
 *
 * Sized to how far a dive RANGES, not how far it swims. A shore dive covering a
 * kilometer of path is usually an out-and-back that never gets more than two or
 * three hundred meters from the entry, so a kilometer-wide field is mostly
 * empty water. That emptiness is not free: the wider the field, the fewer
 * meters per screen pixel, and the harder it is to tap the meter you meant.
 */
export const SITE_EXTENT_M = 250

/**
 * The depth an uncorrected lattice position is drawn at: sea level.
 *
 * Not an estimate, and now not even a plausible one. A field that started ten
 * meters down was a guess wearing the clothes of a reading — it looked like
 * seabed, so a diver had to decide whether each point was already about right.
 * At the surface there is nothing to agree with: the site is a flat sheet of
 * water, and every point of seabed exists only once somebody has pulled it
 * down to the depth they read there.
 */
export const BASE_DEPTH_M = 0

/** A new site: identity and a canvas. */
export function newSiteMap(id: string, name: string, name_en?: string): DiveSiteMap {
  return {
    id,
    name,
    name_en,
    extent_m: SITE_EXTENT_M,
    frame: {},
    provenance: {
      author: 'FunDivers TW',
      license: 'Contributions by divers, reviewed before publication',
    },
    soundings: [],
    features: [],
    bearings: [],
    entries: [],
  }
}

export const LONGDONG_4: DiveSiteMap = newSiteMap(
  'longdong-4',
  '龍洞 4號（和美國小）',
  'Longdong Site 4 (Hemei Elementary)',
)

export const SITE_SEEDS: DiveSiteMap[] = [LONGDONG_4]
