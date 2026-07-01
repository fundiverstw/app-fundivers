import { useEffect, useMemo, useState } from 'react'
import taiwanGeo from '../assets/taiwan.geo.json'
import { supabase } from '../lib/supabase'
import type { DiveSite } from '../types/database'
import { placeLabels } from '../lib/map-layout'
import { wixSiteUrl } from '../lib/dive-site-links'

// High-detail Taiwan map. Coastline data is GADM 4.1 country-level boundaries
// (1,800+ vertices on the main island, 30+ separate Penghu islets, plus
// Keelung Island, Turtle Island, Lanyu, Green Island, Xiao Liuqiu) bundled
// here so the PWA renders offline.
//
// Region metadata (name / center / bbox / description) is hardcoded in this
// file — there are eight fixed regions and the constants are tightly tied
// to the SVG geometry. Dive *sites* live in public.dive_sites and are
// fetched on mount so admins can add/edit them without redeploying the SPA.

type Region =
  | 'keelung'
  | 'longdong'
  | 'yilan'
  | 'greenisland'
  | 'lanyu'
  | 'xiaoliuqiu'
  | 'kenting'
  | 'penghu'

interface RegionInfo {
  name: string
  /** [lon, lat] used for the overview marker. */
  center: [number, number]
  /** [minLon, minLat, maxLon, maxLat] — the camera frames this on zoom. */
  bbox: [number, number, number, number]
  description: string
  /** Optional override for MAX_ZOOM when this region is selected. Bumped
   *  for Keelung / Long Dong where divers want maximum site separation. */
  maxZoom?: number
}

const REGIONS: Record<Region, RegionInfo> = {
  keelung: {
    name: 'Keelung / Badouzi',
    center: [121.81, 25.15],
    // Tightened to fit the actual Keelung sites with a small margin so the
    // natural scale lifts to ~50; the maxZoom cap then lets us approach it.
    bbox: [121.785, 25.122, 121.836, 25.195],
    description: 'Northern port-area diving — Badouzi Bay reefs and shipwrecks, with Keelung Islet just offshore.',
    maxZoom: 40,
  },
  longdong: {
    name: 'Long Dong Bay',
    center: [121.91, 25.118],
    // Tightened to the bay proper (Long Dong Bay + Canyons + 82.5 cluster).
    bbox: [121.895, 25.108, 121.927, 25.130],
    description: 'The classic northeast wall and reef dives — sheer basalt cliffs, deep gullies, dramatic rock formations.',
    maxZoom: 40,
  },
  yilan: {
    name: 'Yilan / Turtle Island',
    center: [121.95, 24.95],
    bbox: [121.810, 24.800, 121.990, 25.050],
    description:
      "East-coast diving — Toucheng / Wai'ao reefs, the Cathedral and Cauliflower Garden walls, the Wan An Jian wreck, " +
      'and Turtle Island offshore (Guishan Dao).',
  },
  greenisland: {
    name: 'Green Island (Lyudao)',
    center: [121.4901443, 22.6620886],
    bbox: [121.460, 22.625, 121.530, 22.700],
    description:
      'Green Island is located off the coast of Taitung, on the southeast coast of Taiwan. It is a favorite dive ' +
      'destination for many locals. Renowned for its impressive visibility, which can reach up to 30–40 m, it is ideal ' +
      'for photography enthusiasts.',
  },
  lanyu: {
    name: 'Lanyu (Orchid Island)',
    center: [121.548418, 22.0435616],
    bbox: [121.470, 21.985, 121.605, 22.115],
    description:
      'Orchid Island is best known for the Badai Wreck, a Korean lumber-carrying vessel that starts at 26 m and ' +
      'descends to 40 m deep.',
  },
  xiaoliuqiu: {
    name: 'Xiao Liuqiu (Lambai Island)',
    center: [120.3715149, 22.3404158],
    bbox: [120.350, 22.315, 120.405, 22.365],
    description:
      'Xiao Liuqiu / Lambai is a large coral island. Due to its nesting beach, it is home to hundreds of green sea ' +
      'turtles that both snorkelers and divers can enjoy.',
  },
  kenting: {
    name: 'Kenting',
    center: [120.7797516, 21.9483307],
    bbox: [120.685, 21.925, 120.845, 22.020],
    description:
      'Kenting has been a top dive destination in Taiwan for decades. It is best known for its myriad of corals that ' +
      'are plastered atop the reef.',
  },
  penghu: {
    name: 'Penghu Islands',
    center: [119.5793157, 23.5711899],
    bbox: [119.290, 23.090, 119.760, 23.700],
    description:
      'Of all the dive locations in Taiwan, Penghu has the most fish in numbers, size, and diversity! If you have the ' +
      "experience and time, it's a definite must-see!",
  },
}

const REGION_ORDER: Region[] = [
  'keelung', 'longdong', 'yilan', 'greenisland', 'lanyu', 'xiaoliuqiu', 'kenting', 'penghu',
]

// --- Projection ----------------------------------------------------------
const VIEW_W = 290
const VIEW_H = 360
const COS_MID_LAT = Math.cos((23.5 * Math.PI) / 180)
const LAT_PX_PER_DEG = 100
const LON_PX_PER_DEG = LAT_PX_PER_DEG * COS_MID_LAT
const LON_MIN = 119.2
const LAT_MAX = 25.3
const MARGIN = 10

const projectX = (lon: number) => (lon - LON_MIN) * LON_PX_PER_DEG + MARGIN
const projectY = (lat: number) => (LAT_MAX - lat) * LAT_PX_PER_DEG + MARGIN

function bboxToSvgRect(bbox: [number, number, number, number]) {
  const [lon0, lat0, lon1, lat1] = bbox
  const x = projectX(lon0)
  const y = projectY(lat1)
  const w = projectX(lon1) - x
  const h = projectY(lat0) - y
  return { x, y, w, h }
}

const REGION_BBOX_SVG: Record<Region, { x: number; y: number; w: number; h: number }> =
  Object.fromEntries(REGION_ORDER.map(r => [r, bboxToSvgRect(REGIONS[r].bbox)])) as never

// Cap chosen to give Keelung / Long Dong / Penghu's small bays enough zoom
// for divers to see individual sites separated, without taking the smallest
// islands (Lanyu, Green Island) past the GADM coastline density.
const MAX_ZOOM = 18

function scaleForRegion(r: Region): number {
  const b = REGION_BBOX_SVG[r]
  const cap = REGIONS[r].maxZoom ?? MAX_ZOOM
  return Math.min(VIEW_W / b.w, VIEW_H / b.h, cap)
}

function transformForRegion(r: Region | null): string {
  if (!r) return 'translate(0px, 0px) scale(1)'
  const b = REGION_BBOX_SVG[r]
  const scale = scaleForRegion(r)
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  const tx = VIEW_W / 2 - scale * cx
  const ty = VIEW_H / 2 - scale * cy
  return `translate(${tx}px, ${ty}px) scale(${scale})`
}

// Project a [lon, lat] coord through the active zoom transform so site
// markers can sit OUTSIDE the scaled coastline group at fixed visual size.
function siteToViewBoxXY(lon: number, lat: number, region: Region): [number, number] {
  const px = projectX(lon)
  const py = projectY(lat)
  const b = REGION_BBOX_SVG[region]
  const scale = scaleForRegion(region)
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  const tx = VIEW_W / 2 - scale * cx
  const ty = VIEW_H / 2 - scale * cy
  return [scale * px + tx, scale * py + ty]
}

// --- Path construction ---------------------------------------------------
type Ring = number[][]
interface Feature { geometry: { type: string; coordinates: Ring[] | Ring[][] } }

function ringToPath(ring: Ring): string {
  return ring
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${projectX(c[0]).toFixed(2)} ${projectY(c[1]).toFixed(2)}`)
    .join(' ') + ' Z'
}

const features = (taiwanGeo as { features: Feature[] }).features
const allPaths = features.map(f => ringToPath((f.geometry.coordinates as Ring[])[0]))

function strokeWidthForZoom(r: Region | null): number {
  if (!r) return 0.5
  return 0.5 / scaleForRegion(r)
}

// --- Component -----------------------------------------------------------
export function MapPage() {
  const [selected, setSelected] = useState<Region | null>(null)
  const [sites, setSites] = useState<DiveSite[]>([])
  // Independent toggles, both on by default. Sites with NULL dive_type
  // (uncategorized) always show — they're not opted out of either filter.
  const [showShore, setShowShore] = useState(true)
  const [showBoat, setShowBoat] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('dive_sites')
        .select('*')
        .order('name')
      if (cancelled) return
      // Silent fall-back: an empty site list still lets the map render with
      // just region pins, which is better than a broken page.
      if (error) return
      setSites((data ?? []) as DiveSite[])
    })()
    return () => { cancelled = true }
  }, [])

  const filteredSites = useMemo(() => sites.filter(s => {
    if (s.dive_type === 'shore') return showShore
    if (s.dive_type === 'boat')  return showBoat
    return true // unspecified type stays visible regardless of toggle.
  }), [sites, showShore, showBoat])

  const sitesByRegion = useMemo(() => {
    const m = new Map<Region, DiveSite[]>()
    REGION_ORDER.forEach(r => m.set(r, []))
    for (const s of filteredSites) {
      const r = s.region as Region
      if (m.has(r)) m.get(r)!.push(s)
    }
    return m
  }, [filteredSites])

  function pick(r: Region) {
    setSelected(prev => (prev === r ? null : r))
  }

  function regionKeyDown(r: Region) {
    return (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        pick(r)
      }
    }
  }

  const stroke = strokeWidthForZoom(selected)
  const visibleSites = useMemo(
    () => (selected ? sitesByRegion.get(selected) ?? [] : []),
    [selected, sitesByRegion],
  )

  // Project each site to SVG coords through the active zoom, then defer to
  // the radial placement helper for layout. Re-attach the original DiveSite
  // reference for rendering after placement returns.
  const visibleSiteLayout = useMemo(() => {
    if (!selected) return []
    const projected = visibleSites.map(s => {
      const [vx, vy] = siteToViewBoxXY(s.longitude, s.latitude, selected)
      return { name: s.name, vx, vy }
    })
    const placed = placeLabels(projected, { bounds: { width: VIEW_W, height: VIEW_H } })
    return placed.map(p => ({
      site: visibleSites[p.index],
      vx: p.vx,
      vy: p.vy,
      labelX: p.labelX,
      labelY: p.labelY,
      anchor: p.anchor,
      rect: p.rect,
      leaderStart: p.leaderStart,
      leaderEnd: p.leaderEnd,
    }))
  }, [selected, visibleSites])

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">Dive sites of Taiwan</h1>
        {selected && (
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="text-xs font-semibold text-amber-300 hover:text-amber-200"
          >
            ← Back to overview
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowShore(v => !v)}
          aria-pressed={showShore}
          aria-label="Toggle shore dives"
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-colors ${
            showShore
              ? 'bg-white border-brand-900 text-brand-900'
              : 'bg-surface-100 border-surface-200 text-brand-950 line-through'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          Shore
        </button>
        <button
          type="button"
          onClick={() => setShowBoat(v => !v)}
          aria-pressed={showBoat}
          aria-label="Toggle boat dives"
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-colors ${
            showBoat
              ? 'bg-white border-brand-900 text-brand-900'
              : 'bg-surface-100 border-surface-200 text-brand-950 line-through'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-surface-500" />
          Boat
        </button>
      </div>
      {!selected && (
        <p className="text-sm text-white/80">Tap a marker or a region below to zoom in.</p>
      )}

      <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 flex justify-center">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full max-w-md"
          role="img"
          aria-label="Map of Taiwan with selectable diving regions"
        >
          <defs>
            {/* Arrowhead at the end of leader lines, pointing at the site
                marker. Long, narrow triangle (3:1 aspect) for a sharp,
                needle-like point. orient="auto" rotates with the line. */}
            <marker
              id="site-arrow"
              viewBox="0 0 12 4"
              refX="11"
              refY="2"
              markerWidth="3.5"
              markerHeight="2.5"
              orient="auto"
            >
              <path d="M 0 0 L 12 2 L 0 4 Z" fill="#dc2626" />
            </marker>
          </defs>

          {/* Zoomable group — only the coastline scales; markers and labels
              live outside this group so they keep a fixed visual size. */}
          <g
            style={{
              transform: transformForRegion(selected),
              transformOrigin: '0 0',
              transition: 'transform 500ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            {allPaths.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="rgb(186 230 253)"
                stroke="#0284c7"
                strokeWidth={stroke}
                strokeLinejoin="round"
              />
            ))}
          </g>

          {/* Region pins — only on overview, fixed visual size. */}
          {!selected && REGION_ORDER.map(id => {
            const r = REGIONS[id]
            const cx = projectX(r.center[0])
            const cy = projectY(r.center[1])
            return (
              <g
                key={id}
                role="button"
                tabIndex={0}
                aria-label={r.name}
                onClick={() => pick(id)}
                onKeyDown={regionKeyDown(id)}
                className="cursor-pointer text-emerald-500 hover:text-emerald-600 focus:text-emerald-700 transition-colors outline-none"
              >
                <circle cx={cx} cy={cy} r="11" fill="transparent" />
                <circle cx={cx} cy={cy} r="4.5" fill="currentColor" stroke="white" strokeWidth="1.5" />
              </g>
            )
          })}

          {/* Site markers — only when zoomed in, projected through the
              region's transform so they land at the right geographic spot
              while keeping a fixed visual size. paint-order=stroke gives
              labels a white halo so they stay legible over coastline. */}
          {selected && visibleSiteLayout.map(({ site, vx, vy, labelX, labelY, anchor, leaderStart, leaderEnd }) => {
            const wixUrl = wixSiteUrl(site.wix_slug)
            const marker = (
              <>
                <circle cx={vx} cy={vy} r="3" fill="#dc2626" stroke="white" strokeWidth="1.2" />
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor={anchor}
                  fontSize="10"
                  fontWeight="700"
                  fill="#1e3a8a"
                  stroke="white"
                  strokeWidth="3.2"
                  paintOrder="stroke fill"
                  strokeLinejoin="round"
                  style={wixUrl ? { textDecoration: 'underline' } : undefined}
                >
                  {site.name}
                </text>
              </>
            )
            return (
              <g key={site.id} className="pointer-events-none">
                <line
                  x1={leaderStart[0]} y1={leaderStart[1]}
                  x2={leaderEnd[0]}   y2={leaderEnd[1]}
                  stroke="#dc2626" strokeWidth="1.4" strokeOpacity="0.8"
                  markerEnd="url(#site-arrow)"
                />
                {wixUrl ? (
                  <a
                    href={wixUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={site.name}
                    className="pointer-events-auto cursor-pointer"
                  >
                    {marker}
                  </a>
                ) : marker}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Region list — alternate way to navigate; mirrors the markers. */}
      <div className="grid grid-cols-2 gap-2">
        {REGION_ORDER.map(id => {
          const r = REGIONS[id]
          const active = selected === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => pick(id)}
              className={`text-left p-3 rounded-lg border text-sm transition-colors ${
                active
                  ? 'bg-emerald-100 border-emerald-500 text-emerald-900 font-semibold'
                  : 'bg-white/70 border-surface-200 text-brand-900 hover:bg-white'
              }`}
            >
              {r.name}
            </button>
          )
        })}
      </div>

      {selected && (
        <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4">
          <div className="flex items-start justify-between mb-2 gap-2">
            <h2 className="text-lg font-bold text-brand-900">{REGIONS[selected].name}</h2>
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Close region details"
              className="text-brand-900/60 hover:text-brand-900 text-2xl leading-none px-2 -mt-1"
            >
              ×
            </button>
          </div>
          <p className="text-sm text-brand-900 mb-3">{REGIONS[selected].description}</p>
          {visibleSites.length > 0 && (
            <>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-brand-900/70 mb-1">
                Dive sites
              </h3>
              <ul className="text-sm text-brand-900 space-y-2">
                {visibleSites.map(s => {
                  const wixUrl = wixSiteUrl(s.wix_slug)
                  return (
                    <li key={s.id}>
                      {wixUrl ? (
                        <a
                          href={wixUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-brand-900 underline decoration-brand-900/40 underline-offset-2 hover:decoration-brand-900"
                        >
                          {s.name}
                        </a>
                      ) : (
                        <strong className="font-semibold">{s.name}</strong>
                      )}
                      {s.tagline && (
                        <p className="text-xs text-brand-900/80 mt-0.5">{s.tagline}</p>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
