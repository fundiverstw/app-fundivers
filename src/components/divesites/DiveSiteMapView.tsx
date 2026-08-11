import {
  boundsOf, viewBoxFor, toSvg, pathData, bearingEnd, scaleBarMetres,
  depthLabel, singleDatum, isVolumetric,
  type DiveSiteMap, type FeatureKind, type SiteFeature,
} from '../../lib/dive-site-map'
import { t } from '../../i18n'
import { CARD, TEXT_HEADING, TEXT_MUTED, TEXT_SUBTLE } from '../../styles/tokens'

// Everything is drawn in `currentColor` at varying opacity rather than in named
// hues. The app ships a dark look and the platform ships a light one as well, so
// a map keyed to specific colours would read on one and vanish on the other;
// inheriting the container's ink means the drawing is legible wherever it lands.
// Kinds are told apart by stroke pattern and fill weight instead of by colour,
// which also survives being printed and being read by a colour-blind diver.

const AREA_STYLE: Partial<Record<FeatureKind, { opacity: number; dash?: string }>> = {
  rock:        { opacity: 0.16 },
  sand:        { opacity: 0.06 },
  slope:       { opacity: 0.10, dash: '3 2' },
  wall:        { opacity: 0.22 },
  formation:   { opacity: 0.24 },
  boundary:    { opacity: 0.04, dash: '4 3' },
  hazard:      { opacity: 0.14, dash: '1 2' },
}

function areaStyle(kind: FeatureKind) {
  return AREA_STYLE[kind] ?? { opacity: 0.12 }
}

function FeatureShape({ feature }: { feature: SiteFeature }) {
  const { geometry, kind, label } = feature
  const style = areaStyle(kind)

  if (geometry.shape === 'point') {
    const p = toSvg(geometry.at)
    // A volumetric feature is the whole reason this is not a depth grid, so it
    // is drawn as a ring rather than a dot: visibly a thing you swim through,
    // not a place with a depth.
    return (
      <g>
        {isVolumetric(kind)
          ? <circle cx={p.x} cy={p.y} r={3} fill="none" stroke="currentColor" strokeWidth={0.8} strokeDasharray="2 1.5" />
          : <circle cx={p.x} cy={p.y} r={1.6} fill="currentColor" opacity={0.7} />}
        {label && <text x={p.x + 4} y={p.y + 1.5} fontSize={4} fill="currentColor" opacity={0.85}>{label}</text>}
      </g>
    )
  }

  const closed = geometry.shape === 'area'
  return (
    <g>
      <path
        d={pathData(geometry.points, closed)}
        fill={closed ? 'currentColor' : 'none'}
        fillOpacity={closed ? style.opacity : undefined}
        stroke="currentColor"
        strokeOpacity={0.5}
        strokeWidth={0.6}
        strokeDasharray={style.dash}
      />
      {label && geometry.points.length > 0 && (
        <text
          x={toSvg(geometry.points[0]).x + 2}
          y={toSvg(geometry.points[0]).y - 2}
          fontSize={4}
          fill="currentColor"
          opacity={0.85}
        >
          {label}
        </text>
      )}
    </g>
  )
}

interface DiveSiteMapViewProps {
  map: DiveSiteMap
  /** Metres drawn for a bearing arrow. The source maps show direction, not
   *  distance, so the length is presentational unless the bearing states one. */
  bearingLength_m?: number
}

export function DiveSiteMapView({ map, bearingLength_m = 12 }: DiveSiteMapViewProps) {
  const bounds = boundsOf(map)

  if (!bounds) {
    return (
      <div className={`${CARD} p-6 text-center`}>
        <p className={TEXT_MUTED}>{t.siteMap.empty}</p>
      </div>
    )
  }

  const bar = scaleBarMetres(bounds)
  const datum = singleDatum(map)
  const barY = -(bounds.minY) + 6
  const barX = bounds.minX + 2

  return (
    <figure className={`${CARD} overflow-hidden`}>
      <svg
        viewBox={viewBoxFor(bounds)}
        className="block h-auto w-full"
        role="img"
        aria-label={t.siteMap.ariaLabel(map.name)}
        preserveAspectRatio="xMidYMid meet"
      >
        <g>
          {map.features.map(f => <FeatureShape key={f.id} feature={f} />)}
        </g>

        <g>
          {map.bearings.map(b => {
            const from = toSvg(b.from)
            const to = toSvg(bearingEnd(b.from, b.degrees, b.distance_m ?? bearingLength_m))
            return (
              <g key={b.id}>
                <line
                  x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  stroke="currentColor" strokeWidth={0.7} opacity={0.75}
                />
                <circle cx={to.x} cy={to.y} r={1.2} fill="currentColor" opacity={0.75} />
                <text x={to.x + 2} y={to.y} fontSize={3.5} fill="currentColor" opacity={0.8}>
                  {b.degrees}°
                </text>
              </g>
            )
          })}
        </g>

        <g>
          {map.soundings.map(s => {
            const p = toSvg(s.at)
            return (
              <g key={s.id}>
                <circle cx={p.x} cy={p.y} r={1} fill="currentColor" />
                <text x={p.x + 2} y={p.y + 1.2} fontSize={4} fill="currentColor" fontWeight="600">
                  {depthLabel(s.depth_m)}
                </text>
              </g>
            )
          })}
        </g>

        <g>
          {map.entries.map(e => {
            const p = toSvg(e.at)
            return (
              <g key={e.id}>
                <path
                  d={`M ${p.x} ${p.y - 4} L ${p.x + 3} ${p.y + 2} L ${p.x - 3} ${p.y + 2} Z`}
                  fill="currentColor"
                />
                <text x={p.x + 5} y={p.y + 2} fontSize={4} fill="currentColor">
                  {e.label ?? t.siteMap.entry}
                </text>
              </g>
            )
          })}
        </g>

        <g opacity={0.85}>
          <line x1={barX} y1={barY} x2={barX + bar} y2={barY} stroke="currentColor" strokeWidth={0.8} />
          <line x1={barX} y1={barY - 1.5} x2={barX} y2={barY + 1.5} stroke="currentColor" strokeWidth={0.8} />
          <line x1={barX + bar} y1={barY - 1.5} x2={barX + bar} y2={barY + 1.5} stroke="currentColor" strokeWidth={0.8} />
          <text x={barX} y={barY + 5} fontSize={3.5} fill="currentColor">{`${bar} m`}</text>
        </g>

        <g opacity={0.85} transform={`translate(${bounds.maxX - 4}, ${-(bounds.maxY - 4)})`}>
          <line x1={0} y1={6} x2={0} y2={-4} stroke="currentColor" strokeWidth={0.7} />
          <path d="M 0 -6 L 1.8 -3 L -1.8 -3 Z" fill="currentColor" />
          <text x={0} y={10} fontSize={3.5} textAnchor="middle" fill="currentColor">
            {t.siteMap.north}
          </text>
        </g>
      </svg>

      <figcaption className="space-y-1 px-4 py-3">
        <p className={`text-sm ${TEXT_HEADING}`}>{map.name}</p>
        <p className={`text-xs ${TEXT_MUTED}`}>
          {t.siteMap.drawnBy(map.provenance.author, map.provenance.year)}
        </p>
        <p className={`text-xs ${TEXT_SUBTLE}`}>
          {datum === 'unknown' || datum === null
            ? t.siteMap.datumUnknown
            : t.siteMap.datumNamed(datum)}
        </p>
        {map.provenance.note && (
          <p className={`text-xs ${TEXT_SUBTLE}`}>{map.provenance.note}</p>
        )}
      </figcaption>
    </figure>
  )
}
