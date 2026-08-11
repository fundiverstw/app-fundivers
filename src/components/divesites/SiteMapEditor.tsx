import { useCallback, useMemo, useState } from 'react'
import type { DiveSiteMap } from '../../lib/dive-site-map'
import {
  emptyDraft, setDepth, applyPick, undo, contributionCount,
  validate, toContribution, withDraft,
  type Contributor, type Draft, type Pick, type SiteContribution,
} from '../../lib/site-map-draft'
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
// looking at removes that translation: you see the point standing proud of the
// seabed at 10 m, you know it is wrong, you tap it and say 24.

// Module-level so the default is a stable reference. Declared inline as a
// default parameter it was a new function on every render, which invalidated
// the pick callback and tore the whole WebGL scene down and back up.
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

  const preview = useMemo(() => withDraft(map, draft), [map, draft])
  const problems = validate(draft)
  const count = contributionCount(draft)

  // Only the marked points are editable; `applyPick` drops anything else.
  const pick = useCallback((hit: Pick) => {
    setDraft(d => applyPick(d, hit, now()))
  }, [now])

  function submit() {
    const contribution = toContribution(draft, map.id, { contributor })
    if (!contribution) return
    onSubmit?.(contribution)
    setDraft(emptyDraft({ depth_m: draft.depth_m }))
  }

  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <label className={`flex items-center gap-1 text-xs ${TEXT_MUTED}`}>
          {t.siteMap.depthField}
          <input
            type="number"
            min={1}
            max={100}
            value={draft.depth_m}
            onChange={e => setDraft(d => setDepth(d, Number(e.target.value)))}
            className={`${INPUT} w-20 py-1 text-xs`}
          />
        </label>

        <span className="flex-1" />

        <button onClick={() => setDraft(undo)} className={BTN_XS_GHOST}>{t.siteMap.undo}</button>
        <button onClick={submit} disabled={problems.length > 0} className={BTN_XS_PRIMARY}>
          {t.siteMap.submit}
        </button>
      </div>

      <DiveSiteScene map={preview} height={height} onPick={pick} />

      <div className="space-y-1 px-4 py-3">
        <p className={`text-sm ${TEXT_HEADING}`}>{t.siteMap.draftCount(count)}</p>
        <p className={`text-xs ${TEXT_MUTED}`}>{t.siteMap.hintDepth3d}</p>
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
