import { useCallback, useMemo, useState } from 'react'
import type { DiveSiteMap, Vec2 } from '../../lib/dive-site-map'
import {
  emptyDraft, placeSounding, markEntry, nameEntry, setTool, undo, contributionCount,
  validate, toContribution, withDraft,
  type Contributor, type Draft, type SiteContribution,
} from '../../lib/site-map-draft'
import {
  editableGrid, expand, gridStep, gridBounds, PATCH_M, NO_EXPANSION,
  type Direction, type Expansion, type GridHandle,
} from '../../lib/site-map-grid'
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

  const preview = useMemo(() => withDraft(map, draft), [map, draft])
  const handles = useMemo(() => editableGrid(preview, expansion), [preview, expansion])
  const step = gridStep(gridBounds(preview, expansion))
  const problems = validate(draft)
  const count = contributionCount(draft)

  const onHandleDrag = useCallback((e: { id: string; at: Vec2; depth_m: number; done: boolean }) => {
    setLive({ id: e.id, at: e.at, depth_m: e.depth_m })
    if (!e.done) return
    setDraft(d => placeSounding(d, e.at, e.depth_m, now(), e.id))
  }, [now])

  const onHandleMark = useCallback((handle: GridHandle) => {
    setDraft(d => markEntry(d, handle.at))
  }, [])

  // Typing a figure corrects the point just pulled, rather than arming a value
  // for the next tap — the old behaviour, and the thing that made this tedious.
  function retype(depth_m: number) {
    if (!live) return
    const corrected = setGrabDepth({ ...live, from_m: live.depth_m, originY: 0 } as Grab, depth_m)
    setLive({ ...live, depth_m: corrected.depth_m })
    setDraft(d => placeSounding(d, live.at, corrected.depth_m, now(), live.id))
  }

  function submit() {
    const contribution = toContribution(draft, map.id, { contributor })
    if (!contribution) return
    onSubmit?.(contribution)
    setDraft(emptyDraft())
    setLive(null)
  }

  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <div className="flex gap-1" role="group" aria-label={t.siteMap.toolAria}>
          <button
            type="button"
            aria-pressed={draft.tool === 'sounding'}
            onClick={() => setDraft(d => setTool(d, 'sounding'))}
            className={draft.tool === 'sounding' ? BTN_XS_PRIMARY : BTN_XS_GHOST}
          >
            {t.siteMap.toolDepths}
          </button>
          <button
            type="button"
            aria-pressed={draft.tool === 'entry'}
            onClick={() => setDraft(d => setTool(d, 'entry'))}
            className={draft.tool === 'entry' ? BTN_XS_PRIMARY : BTN_XS_GHOST}
          >
            {t.siteMap.toolEntries}
          </button>
        </div>

        {draft.tool === 'sounding' && (
          <label className={`flex items-center gap-1 text-xs ${TEXT_MUTED}`}>
            {t.siteMap.depthField}
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              disabled={!live}
              value={live ? live.depth_m : ''}
              onChange={e => retype(Number(e.target.value))}
              className={`${INPUT} w-20 py-1 text-xs disabled:opacity-40`}
            />
          </label>
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
        gesture={draft.tool === 'entry' ? 'mark' : 'pull'}
        onHandleMark={onHandleMark}
      />

      <div className="space-y-1 px-4 py-3">
        <p className={`text-sm ${TEXT_HEADING}`}>{t.siteMap.draftCount(count)}</p>
        <p className={`text-xs ${TEXT_MUTED}`}>
          {draft.tool === 'entry' ? t.siteMap.hintMarkEntry : t.siteMap.hintDrag}
        </p>
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
