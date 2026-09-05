import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { observedOnly, type DiveSiteMap, type Vec2 } from '../../lib/dive-site-map'
import {
  emptyDraft, placeSounding, placeSoundings, markEntry, nameEntry, setTool, undo,
  contributionCount, validate, toContribution, withDraft,
  type Contributor, type Draft, type SiteContribution,
} from '../../lib/site-map-draft'
import {
  editableGrid, expand, gridStep, gridBounds, PATCH_M, NO_EXPANSION,
  type Direction, type Expansion, type GridHandle,
} from '../../lib/site-map-grid'
import {
  ROUTE_TEMPLATES, routeTemplate, suggestedEntry,
  type RouteTemplate, type RouteTemplateId,
} from '../../lib/site-map-routes'
import { setGrabDepth, type Grab } from '../../lib/site-map-grab'
import { DiveSiteScene } from './DiveSiteScene'
import { t } from '../../i18n'
import {
  CARD, TEXT_MUTED, TEXT_SUBTLE, TEXT_HEADING,
  BTN_XS_PRIMARY, BTN_XS_GHOST, INPUT,
} from '../../styles/tokens'

// Contributing happens in the same 3D view the diver reads the site in.
//
// The alternative — a flat plan to edit and a surface to admire — asks someone
// to hold two pictures of the same seabed in their head and trust that a tap on
// one lands where they meant on the other. Editing in the view you are already
// looking at removes that translation.
//
// It used to work the wrong way round: type a depth into a box, then tap the
// seabed to stamp that number onto it. Five different depths meant typing five
// times, and the number was the subject while the place was an afterthought.
// Now the place is the subject. The seabed starts flat, every point of it is a
// handle, and you pull the ones that are wrong to where they belong — the
// depth comes out of the gesture. Grabbing a handle moves it; dragging
// anywhere else moves the camera, which is how you look around without a mode
// to switch.
//
// The typed field is still here, bound to whatever was last pulled, because a
// diver who read 24.3 off a computer should not have to find it with a finger.
//
// Two tools, and only two. Pulling depths is one act; saying where you got
// into the water is another, and a site has as many ways in as it has — a
// slipway, a set of steps, a gap in the rocks that only works at low water.
// They cannot share a gesture: a drag that means "this is 12 m deep" cannot
// also mean "this is the slipway". So the tool is switched explicitly, and the
// view says which one is armed.
//
// SELECTING is the third thing a finger can do, and it is a mode of the depth
// tool rather than a tool of its own: what it gathers is points to state a
// depth for. Most of a real dive is flat — a sand bottom at 8 m, a ledge at
// 12 — and pulling four hundred points to the same figure one at a time is the
// reason nobody would fill in a site. Select the stretch, say the number once,
// and every point in it carries that reading with the diver's name on it. The
// depth is still stated, not interpolated: a selection is a claim about all of
// it, which is what a diver who swam along it is entitled to make.
//
// A BASE ROUTE is the other half of the same problem. An empty site is a flat
// sheet of water and a blank page; a route lays the shape a shore dive, a wall
// or a sand flat usually has under the field, so the work starts as correcting
// a shape rather than building one. It is scaffolding and stays scaffolding —
// see site-map-routes.ts — and contributes nothing until points are pulled.

// Module-level so the default is a stable reference. Declared inline as a
// default parameter it was a new function on every render, which invalidated
// the drag callback and tore the whole WebGL scene down and back up.
const systemNow = () => new Date().toISOString()

const EXTEND_LABEL = {
  north: 'extendNorth', south: 'extendSouth', east: 'extendEast', west: 'extendWest',
} as const

interface SiteMapEditorProps {
  map: DiveSiteMap
  /** The signed-in diver, for display only. The server stamps the authoritative
   *  contributor from the session — see `SiteContribution.contributor`. */
  contributor?: Contributor
  onSubmit?: (contribution: SiteContribution) => void
  /** Injected so a test can pin the observation time; defaults to now. */
  now?: () => string
  height?: number
}

export function SiteMapEditor({
  map, contributor, onSubmit, now = systemNow, height = 460,
}: SiteMapEditorProps) {
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  // The point under the finger right now. Held apart from the draft on
  // purpose: writing it into the draft on every frame would rebuild the map
  // the scene is rendering, tearing the WebGL context down mid-gesture.
  const [live, setLive] = useState<{ id: string; at: Vec2; depth_m: number } | null>(null)
  // Ground the diver has asked for but not yet written anything on. Held here
  // rather than stored: an empty patch is not data, and once a point on it is
  // pulled the reading itself is what says the site reaches that far.
  const [expansion, setExpansion] = useState<Expansion>(NO_EXPANSION)
  // Lattice ids gathered for one statement. Not in the draft: a selection is
  // what the diver is looking at, not part of what they are proposing, and it
  // must not survive into a contribution.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [selecting, setSelecting] = useState(false)
  const [routeId, setRouteId] = useState<RouteTemplateId | ''>('')
  // The figure in the box. Its own state now rather than a read of `live`: with
  // a selection there may be no point under the finger to read it off, and the
  // depth is still something the diver is entitled to type.
  const [typed, setTyped] = useState('')

  const route: RouteTemplate | null = routeTemplate(routeId)
  // The suggested entry rides on the map the scene draws, not on the draft:
  // it is a suggestion, and a draft is a set of claims.
  const scaffolded = useMemo(
    () => (route ? { ...map, entries: [...map.entries, suggestedEntry(route)] } : map),
    [map, route],
  )
  const preview = useMemo(() => withDraft(scaffolded, draft), [scaffolded, draft])
  const handles = useMemo(
    () => editableGrid(preview, expansion, route ?? undefined),
    [preview, expansion, route],
  )
  const step = gridStep(gridBounds(preview, expansion, route ?? undefined))
  const problems = validate(draft)
  const count = contributionCount(draft)
  // A base route is a starting shape, so it is offered while there is nothing
  // to start from. Once the site holds readings the shape would be laid under
  // somebody else's measurements, which is not scaffolding any more.
  const offerRoutes = observedOnly(map).soundings.length === 0

  // Read through refs by the scene callbacks below, which must keep the same
  // identity across renders: rebuilt callbacks tear the WebGL scene down and
  // put it back up, mid-gesture.
  const handlesRef = useRef(handles)
  const selectedRef = useRef(selected)
  useEffect(() => { handlesRef.current = handles }, [handles])
  useEffect(() => { selectedRef.current = selected }, [selected])

  /** The points a depth typed or pulled right now would be written to. */
  function targets(): { id: string; at: Vec2 }[] {
    return handlesRef.current
      .filter(h => selectedRef.current.has(h.id))
      .map(h => ({ id: h.id, at: h.at }))
  }

  const onHandleDrag = useCallback((e: { id: string; at: Vec2; depth_m: number; done: boolean }) => {
    setLive({ id: e.id, at: e.at, depth_m: e.depth_m })
    setTyped(String(e.depth_m))
    if (!e.done) return
    // Pulling a point that is part of the selection states that depth for the
    // whole of it; pulling one outside the selection is about that point alone,
    // and leaves the selection where it was.
    const withSelection = selectedRef.current.has(e.id)
    setDraft(d => (withSelection
      ? placeSoundings(d, targets(), e.depth_m, now())
      : placeSounding(d, e.at, e.depth_m, now(), e.id)))
  }, [now])

  const onHandleMark = useCallback((handle: GridHandle) => {
    setDraft(d => markEntry(d, handle.at))
  }, [])

  const onHandleSelect = useCallback((handle: GridHandle) => {
    setSelected(current => {
      const next = new Set(current)
      if (!next.delete(handle.id)) next.add(handle.id)
      return next
    })
  }, [])

  // A box adds to what is held rather than replacing it: a ledge is often two
  // or three boxes from different angles, and starting over each time would
  // make the second box undo the first.
  const onSelectBox = useCallback((ids: string[]) => {
    setSelected(current => new Set([...current, ...ids]))
  }, [])

  // Typing a figure corrects the point just pulled, rather than arming a value
  // for the next tap — the old behaviour, and the thing that made this tedious.
  // With points selected it states that depth for all of them at once.
  function retype(raw: string) {
    setTyped(raw)
    const depth_m = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(depth_m)) return
    const chosen = targets()
    if (chosen.length) {
      const corrected = setGrabDepth({ from_m: depth_m, originY: 0, depth_m } as Grab, depth_m)
      setDraft(d => placeSoundings(d, chosen, corrected.depth_m, now()))
      return
    }
    if (!live) return
    const corrected = setGrabDepth({ ...live, from_m: live.depth_m, originY: 0 } as Grab, depth_m)
    setLive({ ...live, depth_m: corrected.depth_m })
    setDraft(d => placeSounding(d, live.at, corrected.depth_m, now(), live.id))
  }

  function chooseTool(tool: 'sounding' | 'entry', select = false) {
    setDraft(d => setTool(d, tool))
    setSelecting(tool === 'sounding' && select)
  }

  function submit() {
    const contribution = toContribution(draft, map.id, { contributor })
    if (!contribution) return
    onSubmit?.(contribution)
    setDraft(emptyDraft())
    setLive(null)
    setSelected(new Set())
    setTyped('')
  }

  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <div className="flex gap-1" role="group" aria-label={t.siteMap.toolAria}>
          <button
            type="button"
            aria-pressed={draft.tool === 'sounding' && !selecting}
            onClick={() => chooseTool('sounding')}
            className={draft.tool === 'sounding' && !selecting ? BTN_XS_PRIMARY : BTN_XS_GHOST}
          >
            {t.siteMap.toolDepths}
          </button>
          <button
            type="button"
            aria-pressed={draft.tool === 'sounding' && selecting}
            onClick={() => chooseTool('sounding', true)}
            className={draft.tool === 'sounding' && selecting ? BTN_XS_PRIMARY : BTN_XS_GHOST}
          >
            {t.siteMap.toolSelect}
          </button>
          <button
            type="button"
            aria-pressed={draft.tool === 'entry'}
            onClick={() => chooseTool('entry')}
            className={draft.tool === 'entry' ? BTN_XS_PRIMARY : BTN_XS_GHOST}
          >
            {t.siteMap.toolEntries}
          </button>
        </div>

        {draft.tool === 'sounding' && (
          <label className={`flex items-center gap-1 text-xs ${TEXT_MUTED}`}>
            {selected.size ? t.siteMap.depthFieldMany(selected.size) : t.siteMap.depthField}
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              disabled={!live && selected.size === 0}
              value={typed}
              onChange={e => retype(e.target.value)}
              className={`${INPUT} w-20 py-1 text-xs disabled:opacity-40`}
            />
          </label>
        )}

        {selected.size > 0 && (
          <button
            type="button"
            className={BTN_XS_GHOST}
            onClick={() => setSelected(new Set())}
          >
            {t.siteMap.clearSelection}
          </button>
        )}

        <span className="flex-1" />

        <button onClick={() => { setDraft(undo); setLive(null) }} className={BTN_XS_GHOST}>
          {t.siteMap.undo}
        </button>
        <button onClick={submit} disabled={problems.length > 0 || count === 0} className={BTN_XS_PRIMARY}>
          {t.siteMap.submit}
        </button>
      </div>

      <DiveSiteScene
        map={preview}
        height={height}
        handles={handles}
        onHandleDrag={onHandleDrag}
        gesture={draft.tool === 'entry' ? 'mark' : selecting ? 'select' : 'pull'}
        onHandleMark={onHandleMark}
        selected={selected}
        onHandleSelect={onHandleSelect}
        onSelectBox={onSelectBox}
      />

      <div className="space-y-1 px-4 py-3">
        <p className={`text-sm ${TEXT_HEADING}`}>{t.siteMap.draftCount(count)}</p>
        <p className={`text-xs ${TEXT_MUTED}`}>
          {draft.tool === 'entry'
            ? t.siteMap.hintMarkEntry
            : selecting ? t.siteMap.hintSelect : t.siteMap.hintDrag}
        </p>
        {selected.size > 0 && (
          <p className={`text-xs ${TEXT_HEADING}`}>{t.siteMap.selectedCount(selected.size)}</p>
        )}
        {/* Said here as well as under the view: this is the screen where a
            diver decides which point to pull, and what a point is worth is the
            thing they need to know to decide. */}
        <p className={`text-xs ${TEXT_MUTED}`}>{t.siteMap.handleSpacing(step)}</p>

        {draft.entries.length > 0 && (
          <div className="pt-2">
            <p className={`text-xs ${TEXT_HEADING}`}>{t.siteMap.entriesHeading}</p>
            <ul className="mt-1 space-y-1">
              {draft.entries.map(entry => (
                <li key={entry.id} className="flex items-center gap-2">
                  <span className={`shrink-0 text-xs ${TEXT_SUBTLE}`}>
                    {t.siteMap.entryAt(entry.at.x, entry.at.y)}
                  </span>
                  <input
                    type="text"
                    value={entry.label ?? ''}
                    placeholder={t.siteMap.entryLabelPlaceholder}
                    aria-label={t.siteMap.entryLabelAria(t.siteMap.entryAt(entry.at.x, entry.at.y))}
                    onChange={e => setDraft(d => nameEntry(d, entry.id, e.target.value))}
                    className={`${INPUT} min-w-0 flex-1 py-1 text-xs`}
                  />
                  <button
                    type="button"
                    className={BTN_XS_GHOST}
                    onClick={() => setDraft(d => markEntry(d, entry.at))}
                  >
                    {t.siteMap.entryRemove}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {offerRoutes && (
          <div className="pt-2">
            <p className={`text-xs ${TEXT_HEADING}`}>{t.siteMap.routesHeading}</p>
            <p className={`text-xs ${TEXT_SUBTLE}`}>{t.siteMap.routesNote}</p>
            <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label={t.siteMap.routesHeading}>
              <button
                type="button"
                aria-pressed={routeId === ''}
                className={routeId === '' ? BTN_XS_PRIMARY : BTN_XS_GHOST}
                onClick={() => setRouteId('')}
              >
                {t.siteMap.routeNone}
              </button>
              {ROUTE_TEMPLATES.map(template => (
                <button
                  key={template.id}
                  type="button"
                  aria-pressed={routeId === template.id}
                  className={routeId === template.id ? BTN_XS_PRIMARY : BTN_XS_GHOST}
                  onClick={() => setRouteId(template.id)}
                >
                  {t.siteMap.routes[template.id]}
                </button>
              ))}
            </div>
            {route && <p className={`mt-1 text-xs ${TEXT_MUTED}`}>{t.siteMap.routeNotes[route.id]}</p>}
          </div>
        )}

        <div className="pt-2">
          <p className={`text-xs ${TEXT_HEADING}`}>{t.siteMap.extendHeading}</p>
          <p className={`text-xs ${TEXT_SUBTLE}`}>{t.siteMap.extendNote(PATCH_M)}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {(['north', 'south', 'east', 'west'] as Direction[]).map(direction => (
              <button
                key={direction}
                type="button"
                className={BTN_XS_GHOST}
                onClick={() => setExpansion(e => expand(e, direction))}
              >
                {t.siteMap[EXTEND_LABEL[direction]]}
              </button>
            ))}
          </div>
        </div>
        {problems.includes('implausible_depth') && (
          <p className={`text-xs ${TEXT_SUBTLE}`}>{t.siteMap.problemDepth}</p>
        )}
        {contributor && (
          <p className={`text-xs ${TEXT_SUBTLE}`}>{t.siteMap.attributedTo(contributor.name)}</p>
        )}
        <p className={`text-xs ${TEXT_SUBTLE}`}>{t.siteMap.submitNote}</p>
      </div>
    </div>
  )
}
