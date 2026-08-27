import { supabase } from './supabase'
import type { DiveSiteMap, Sounding, SiteFeature, Vec2 } from './dive-site-map'
import type { SiteContribution } from './site-map-draft'
import type { DiveSite } from '../types/database'
import { siteName } from './dive-sites'

// Reading and writing a dive-site map.
//
// The model in `dive-site-map.ts` is the shape the renderer and the editor
// speak; the four tables behind it are the shape that keeps every observation
// individually attributable. This is the seam between them, and it is the only
// place either shape has to know the other exists.

interface SoundingRow {
  id: string
  x: number | string
  y: number | string
  depth_m: number | string
  datum: Sounding['datum']
  observed_at: string | null
  source: Sounding['source']
  contribution_id: string | null
  supersedes: string | null
  uncertainty_m: number | string | null
}

interface FeatureRow {
  id: string
  kind: SiteFeature['kind']
  shape: 'point' | 'path' | 'area'
  points: Vec2[]
  label: string | null
  source: SiteFeature['source']
  contribution_id: string | null
}

interface MapRow {
  extent_m: number | string | null
  origin_lat: number | string | null
  origin_lng: number | string | null
  rotation_deg: number | string | null
  provenance: DiveSiteMap['provenance'] | null
  bearings: DiveSiteMap['bearings'] | null
  entries: DiveSiteMap['entries'] | null
}

// Postgres numerics arrive as strings through PostgREST, and a coordinate that
// is a string silently becomes NaN the first time it is drawn.
const num = (v: number | string | null | undefined): number | undefined =>
  v === null || v === undefined ? undefined : Number(v)

function toSounding(row: SoundingRow): Sounding {
  return {
    id: row.id,
    at: { x: Number(row.x), y: Number(row.y) },
    depth_m: Number(row.depth_m),
    datum: row.datum,
    ...(row.observed_at ? { observed_at: row.observed_at } : {}),
    source: row.source,
    ...(row.contribution_id ? { contribution_id: row.contribution_id } : {}),
    ...(row.supersedes ? { supersedes: row.supersedes } : {}),
    ...(row.uncertainty_m !== null ? { uncertainty_m: Number(row.uncertainty_m) } : {}),
  }
}

function toFeature(row: FeatureRow): SiteFeature {
  const points = row.points ?? []
  return {
    id: row.id,
    kind: row.kind,
    geometry: row.shape === 'point'
      ? { shape: 'point', at: points[0] ?? { x: 0, y: 0 } }
      : { shape: row.shape, points },
    ...(row.label ? { label: row.label } : {}),
    source: row.source,
    ...(row.contribution_id ? { contribution_id: row.contribution_id } : {}),
  }
}

/**
 * The map for one place, as the renderer wants it.
 *
 * A site with no map row yet is not an error — it is the ordinary state of
 * every place nobody has measured. It comes back as a real, empty map so the
 * editor has a canvas to draw on, rather than as null for the caller to
 * special-case into one.
 */
export async function fetchSiteMap(site: DiveSite): Promise<DiveSiteMap> {
  const [mapRes, soundingRes, featureRes] = await Promise.all([
    supabase.from('dive_site_maps').select('*').eq('site_id', site.id).maybeSingle(),
    supabase.from('dive_site_soundings').select('*').eq('site_id', site.id),
    supabase.from('dive_site_features').select('*').eq('site_id', site.id),
  ])
  if (soundingRes.error) throw soundingRes.error
  if (featureRes.error) throw featureRes.error

  const row = (mapRes.data ?? null) as MapRow | null
  const originLat = num(row?.origin_lat)
  const originLng = num(row?.origin_lng)

  return {
    id: site.id,
    name: siteName(site),
    ...(site.name === siteName(site) ? {} : { name_en: site.name }),
    ...(num(row?.extent_m) !== undefined ? { extent_m: num(row?.extent_m)! } : {}),
    frame: {
      ...(originLat !== undefined && originLng !== undefined
        ? { origin: { lat: originLat, lng: originLng } }
        : {}),
      ...(num(row?.rotation_deg) !== undefined ? { rotationDeg: num(row?.rotation_deg)! } : {}),
    },
    provenance: row?.provenance ?? { author: '' },
    soundings: ((soundingRes.data ?? []) as SoundingRow[]).map(toSounding),
    features: ((featureRes.data ?? []) as FeatureRow[]).map(toFeature),
    bearings: row?.bearings ?? [],
    entries: row?.entries ?? [],
  }
}

/** File a batch of readings. Returns the contribution id they arrived on. */
export async function submitSiteMapContribution(args: {
  siteId: string
  contribution: SiteContribution
  note?: string
}): Promise<string> {
  const { data, error } = await supabase.rpc('submit_site_map_contribution', {
    p_site_id: args.siteId,
    p_soundings: args.contribution.soundings,
    p_features: args.contribution.features,
    p_note: args.note ?? null,
  })
  if (error) throw error
  return data as string
}
