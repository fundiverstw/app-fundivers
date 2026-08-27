import { useCallback, useMemo, useState } from 'react'
import type { DiveSiteMap, Vec2 } from '../../lib/dive-site-map'
import {
  emptyDraft, placeSoundingAt, undo, contributionCount,
  validate, toContribution, withDraft,
  type Contributor, type Draft, type SiteContribution,
} from '../../lib/site-map-draft'
import { editableGrid } from '../../lib/site-map-grid'
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

// Module-level so the default is a stable reference. Declared inline as a
// default parameter it was a new function on every render, which invalidated
// the drag callback and tore the whole WebGL scene down and back up.
const systemNow = () => new Date().toISOString()

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

  const preview = useMemo(() => withDraft(map, draft), [map, draft])
  const handles = useMemo(() => editableGrid(preview), [preview])
  const problems = validate(draft)
  const count = contributionCount(draft)

  const onHandleDrag = useCallback((e: { id: string; at: Vec2; depth_m: number; done: boolean }) => {
    setLive({ id: e.id, at: e.at, depth_m: e.depth_m })
    if (!e.done) return
    setDraft(d => placeSoundingAt(d, e.at, e.depth_m, now(), e.id))
  }, [now])

  // Typing a figure corrects the point just pulled, rather than arming a value
  // for the next tap — the old behaviour, and the thing that made this tedious.
  function retype(depth_m: number) {
    if (!live) return
    const corrected = setGrabDepth({ ...live, from_m: live.depth_m, originY: 0 } as Grab, depth_m)
    setLive({ ...live, depth_m: corrected.depth_m })
    setDraft(d => placeSoundingAt(d, live.at, corrected.depth_m, now(), live.id))
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
      />

      <div className="space-y-1 px-4 py-3">
        <p className={`text-sm ${TEXT_HEADING}`}>{t.siteMap.draftCount(count)}</p>
        <p className={`text-xs ${TEXT_MUTED}`}>{t.siteMap.hintDrag}</p>
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
