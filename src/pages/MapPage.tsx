import { useState } from 'react'
import taiwanGeo from '../assets/taiwan.geo.json'

// High-detail Taiwan map. Coastline data is GADM 4.1 country-level boundaries
// (1,800+ vertices on the main island, 30+ separate Penghu islets, plus
// Keelung Island, Turtle Island, Lanyu, Green Island, Xiao Liuqiu) bundled
// here so the PWA renders offline. Coordinates are projected with an
// equirectangular formula scaled by cos(latitude) so the island reads at
// honest aspect ratio.
//
// Interaction model:
//   - Overview state shows every island plus emerald markers at each
//     dive-region center. Tapping a marker (or its row in the list below
//     the map) flies the camera to that region's bbox.
//   - When zoomed in, the markers hide so they don't blow up under the
//     transform; the user navigates back via the × on the panel or the
//     "Back to overview" button.

type Region =
  | 'penghu'
  | 'keelung'
  | 'longdong'
  | 'yilan'
  | 'south'
  | 'lanyu'
  | 'greenisland'

interface RegionInfo {
  name: string
  /** [lon, lat] used for the overview marker. */
  center: [number, number]
  /** [minLon, minLat, maxLon, maxLat] — the camera frames this on zoom. */
  bbox: [number, number, number, number]
  description: string
  sites: string[]
}

const REGIONS: Record<Region, RegionInfo> = {
  keelung: {
    name: 'Keelung / Badouzi',
    center: [121.79, 25.16],
    bbox: [121.69, 25.05, 121.92, 25.27],
    description:
      'Northern port-area diving — Badouzi reefs, Wanghaixiang Bay, with Keelung Islet (基隆嶼) just offshore. ' +
      'Year-round, visibility 10–20 m, 18–26°C.',
    sites: ['Badouzi (八斗子)', 'Wanghaixiang Bay', 'Keelung Islet (基隆嶼)', 'Heping Island'],
  },
  longdong: {
    name: 'Long Dong Bay',
    center: [121.92, 25.10],
    bbox: [121.85, 25.03, 121.99, 25.16],
    description:
      'The classic northeast wall dive — sheer basalt cliffs, dramatic rock formations, deep gullies. ' +
      'Best summer–fall, visibility 15–25 m. Easy shore entry.',
    sites: ['Long Dong Bay (龍洞灣)', 'First Cave', 'Second Cave', 'Bitou Cape'],
  },
  yilan: {
    name: 'Yilan / Turtle Island',
    center: [121.95, 24.85],
    bbox: [121.78, 24.45, 122.10, 25.05],
    description:
      "East-coast diving — Wushibi reefs, Toucheng, Wai'ao, with Turtle Island (Guishan Dao) offshore. " +
      'Volcanic seabed and underwater hot vents. Summer-only (April–October), visibility 15–25 m.',
    sites: ['Wushibi Reef (烏石鼻)', "Wai'ao", 'Turtle Island (龜山島)'],
  },
  south: {
    name: 'Kenting / Xiao Liuqiu',
    center: [120.55, 22.10],
    bbox: [120.05, 21.85, 120.95, 22.55],
    description:
      "Warm water year-round, healthy coral gardens, frequent macro encounters. Xiao Liuqiu — Taiwan's only coral " +
      "island — has resident green turtles. Kenting peninsula carries Taiwan's most popular dive sites. Visibility 15–30 m.",
    sites: ['South Bay (南灣)', 'Houbihu (後壁湖)', 'Wanlitong', 'Sail Rock (船帆石)', 'Xiao Liuqiu (小琉球)'],
  },
  lanyu: {
    name: 'Lanyu (Orchid Island)',
    center: [121.55, 22.05],
    bbox: [121.43, 21.95, 121.67, 22.15],
    description:
      'Volcanic island off SE Taiwan, home to the Tao indigenous people. Drift dives along basalt walls, big pelagic ' +
      'encounters. Summer-only access. Visibility 25–40 m, 24–28°C.',
    sites: ['Eight Generations Bay', 'Lanyu Lighthouse', 'Yuren coast'],
  },
  greenisland: {
    name: 'Green Island (Lyudao)',
    center: [121.50, 22.66],
    bbox: [121.42, 22.58, 121.58, 22.74],
    description:
      'Coral reefs, hot springs, year-round diving with reliable conditions. Drift on the east side, mooring sites on ' +
      'the west. Visibility 20–35 m, 22–28°C.',
    sites: ['Shilang (石朗)', 'Big Mushroom (大香菇)', 'Sleeping Beauty Rock', 'Chaikou'],
  },
  penghu: {
    name: 'Penghu Islands',
    center: [119.50, 23.50],
    bbox: [119.18, 23.00, 119.78, 23.80],
    description:
      'Volcanic basalt formations across 90+ islands. Summer-only diving (April–October), occasional drift ' +
      'conditions. Visibility 20–35 m. Reached by ferry or short flight.',
    sites: ['Magong (馬公)', "Wang'an", 'Cimei', 'Niao Yu (鳥嶼)'],
  },
}

const REGION_ORDER: Region[] = [
  'keelung', 'longdong', 'yilan', 'greenisland', 'lanyu', 'south', 'penghu',
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

// Convert a geographic bbox [minLon, minLat, maxLon, maxLat] to the
// rectangular SVG region the camera will fly to.
function bboxToSvgRect(bbox: [number, number, number, number]) {
  const [lon0, lat0, lon1, lat1] = bbox
  const x = projectX(lon0)
  const y = projectY(lat1) // top of svg = highest latitude
  const w = projectX(lon1) - x
  const h = projectY(lat0) - y
  return { x, y, w, h }
}

// Pre-compute camera transforms for each region.
const REGION_BBOX_SVG: Record<Region, { x: number; y: number; w: number; h: number }> =
  Object.fromEntries(REGION_ORDER.map(r => [r, bboxToSvgRect(REGIONS[r].bbox)])) as never

function transformForRegion(r: Region | null): string {
  if (!r) return 'translate(0px, 0px) scale(1)'
  const b = REGION_BBOX_SVG[r]
  // Tight zooms shouldn't exceed 8× — past that, vertex density runs out
  // and the coastline starts to look polygonal even at GADM resolution.
  const scale = Math.min(VIEW_W / b.w, VIEW_H / b.h, 8)
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  const tx = VIEW_W / 2 - scale * cx
  const ty = VIEW_H / 2 - scale * cy
  return `translate(${tx}px, ${ty}px) scale(${scale})`
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
// All polygon paths, one per island feature. The base map renders all of
// them in the same fill — region selection is handled via marker clicks,
// not feature clicks.
const allPaths = features.map(f => ringToPath((f.geometry.coordinates as Ring[])[0]))

// Width of stroke around each island. Inversely scales with zoom so the
// outline doesn't fatten visually as the camera flies in.
function strokeWidthForZoom(r: Region | null): number {
  if (!r) return 0.5
  const b = REGION_BBOX_SVG[r]
  const scale = Math.min(VIEW_W / b.w, VIEW_H / b.h, 8)
  return 0.5 / scale
}

// --- Component -----------------------------------------------------------
export function MapPage() {
  const [selected, setSelected] = useState<Region | null>(null)

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
      {!selected && (
        <p className="text-sm text-white/80">Tap a marker or a region below to zoom in.</p>
      )}

      <div className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 flex justify-center">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full max-w-md"
          role="img"
          aria-label="Map of Taiwan with selectable diving regions"
        >
          {/* Zoomable group — only the coastline scales; markers and labels
              live outside this group so they keep a fixed size. */}
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

          {/* Region markers — pinned, fixed-size. Each is a transparent
              hit target plus a visible dot, so touch tap zones stay easy
              to hit without inflating the rendered marker. */}
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
                  : 'bg-white/70 border-sky-200 text-blue-900 hover:bg-white'
              }`}
            >
              {r.name}
            </button>
          )
        })}
      </div>

      {selected && (
        <div className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4">
          <div className="flex items-start justify-between mb-2 gap-2">
            <h2 className="text-lg font-bold text-blue-900">{REGIONS[selected].name}</h2>
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Close region details"
              className="text-blue-900/60 hover:text-blue-900 text-2xl leading-none px-2 -mt-1"
            >
              ×
            </button>
          </div>
          <p className="text-sm text-blue-900 mb-3">{REGIONS[selected].description}</p>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-900/70 mb-1">
            Dive sites
          </h3>
          <ul className="text-sm text-blue-900 space-y-0.5">
            {REGIONS[selected].sites.map(s => (
              <li key={s}>• {s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
