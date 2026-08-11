import { describe, it, expect } from 'vitest'
import {
  emptyDraft, setTool, setDepth, setFeatureKind, placeSounding, addVertex,
  canCommitPath, commitPath, undo, contributionCount, isEmpty, validate,
  toContribution, withDraft, contributionsByDiver, snapTarget, supersededIds,
  applyPick, MAX_PLAUSIBLE_DEPTH_M,
} from './site-map-draft'
import type { DiveSiteMap, Sounding } from './dive-site-map'

const NOW = '2026-08-11T02:15:00Z'

function baseMap(): DiveSiteMap {
  return {
    id: 'site-1', name: 'Site', frame: {}, provenance: { author: 'x' },
    soundings: [], features: [], bearings: [], entries: [],
  }
}

describe('placing soundings', () => {
  it('stamps each one instantaneous, timed, and attributed to the diver', () => {
    const d = placeSounding(setDepth(emptyDraft(), 18), { x: 4, y: -2 }, NOW)
    expect(d.soundings).toHaveLength(1)
    expect(d.soundings[0]).toMatchObject({
      depth_m: 18, datum: 'instantaneous', observed_at: NOW, source: 'diver',
    })
  })

  it('keeps using the set depth until it is changed', () => {
    let d = setDepth(emptyDraft(), 12)
    d = placeSounding(d, { x: 0, y: 0 }, NOW)
    d = placeSounding(d, { x: 5, y: 5 }, NOW)
    d = placeSounding(setDepth(d, 20), { x: 9, y: 9 }, NOW)
    expect(d.soundings.map(s => s.depth_m)).toEqual([12, 12, 20])
  })
})

describe('drawing shapes', () => {
  it('needs two points for a contour and three for an outline', () => {
    let contour = setTool(emptyDraft(), 'contour')
    contour = addVertex(contour, { x: 0, y: 0 })
    expect(canCommitPath(contour)).toBe(false)
    contour = addVertex(contour, { x: 5, y: 0 })
    expect(canCommitPath(contour)).toBe(true)

    let area = setTool(emptyDraft(), 'feature')
    area = addVertex(addVertex(area, { x: 0, y: 0 }), { x: 5, y: 0 })
    expect(canCommitPath(area)).toBe(false)
    area = addVertex(area, { x: 5, y: 5 })
    expect(canCommitPath(area)).toBe(true)
  })

  it('commits a contour as an open path and a feature as a closed area', () => {
    let contour = setTool(emptyDraft(), 'contour')
    contour = commitPath(addVertex(addVertex(contour, { x: 0, y: 0 }), { x: 5, y: 0 }))
    expect(contour.features[0].geometry.shape).toBe('path')

    let area = setTool(emptyDraft(), 'feature')
    area = addVertex(addVertex(addVertex(area, { x: 0, y: 0 }), { x: 5, y: 0 }), { x: 5, y: 5 })
    area = commitPath(area, 'Dragon Head')
    expect(area.features[0].geometry.shape).toBe('area')
    expect(area.features[0].label).toBe('Dragon Head')
  })

  it('applies the chosen feature kind, and files contours as boundaries', () => {
    let area = setFeatureKind(setTool(emptyDraft(), 'feature'), 'swim_through')
    area = addVertex(addVertex(addVertex(area, { x: 0, y: 0 }), { x: 1, y: 0 }), { x: 1, y: 1 })
    expect(commitPath(area).features[0].kind).toBe('swim_through')

    let contour = setTool(emptyDraft(), 'contour')
    contour = commitPath(addVertex(addVertex(contour, { x: 0, y: 0 }), { x: 5, y: 0 }))
    expect(contour.features[0].kind).toBe('boundary')
  })

  it('refuses to commit a shape with too few points instead of making one up', () => {
    const d = addVertex(setTool(emptyDraft(), 'feature'), { x: 0, y: 0 })
    expect(commitPath(d)).toEqual(d)
  })

  it('abandons a half-drawn shape when the tool changes', () => {
    let d = addVertex(setTool(emptyDraft(), 'contour'), { x: 0, y: 0 })
    d = setTool(d, 'sounding')
    expect(d.pending).toEqual([])
  })
})

describe('undo', () => {
  it('removes the last vertex before touching anything already committed', () => {
    let d = setTool(emptyDraft(), 'contour')
    d = commitPath(addVertex(addVertex(d, { x: 0, y: 0 }), { x: 5, y: 0 }))
    d = addVertex(d, { x: 9, y: 9 })
    d = undo(d)
    expect(d.pending).toEqual([])
    expect(d.features).toHaveLength(1)
  })

  it('then removes committed shapes, then soundings', () => {
    let d = placeSounding(emptyDraft(), { x: 0, y: 0 }, NOW)
    d = setTool(d, 'contour')
    d = commitPath(addVertex(addVertex(d, { x: 0, y: 0 }), { x: 5, y: 0 }))
    d = undo(d)
    expect(d.features).toHaveLength(0)
    expect(d.soundings).toHaveLength(1)
    d = undo(d)
    expect(d.soundings).toHaveLength(0)
  })

  it('does nothing on an empty draft rather than throwing', () => {
    const d = emptyDraft()
    expect(undo(d)).toEqual(d)
  })
})

describe('validation', () => {
  it('rejects an empty draft', () => {
    expect(validate(emptyDraft())).toContain('empty')
  })

  it('rejects a draft with a shape still being drawn', () => {
    let d = placeSounding(emptyDraft(), { x: 0, y: 0 }, NOW)
    d = addVertex(setTool(d, 'contour'), { x: 1, y: 1 })
    expect(validate(d)).toContain('unfinished_shape')
  })

  it('rejects a sounding with no time, because it could never be tide-corrected', () => {
    const d = placeSounding(emptyDraft(), { x: 0, y: 0 }, NOW)
    d.soundings[0].observed_at = undefined
    expect(validate(d)).toContain('sounding_without_time')
  })

  it('rejects depths that are impossible rather than merely deep', () => {
    expect(validate(placeSounding(setDepth(emptyDraft(), 0), { x: 0, y: 0 }, NOW)))
      .toContain('implausible_depth')
    expect(validate(placeSounding(setDepth(emptyDraft(), MAX_PLAUSIBLE_DEPTH_M + 1), { x: 0, y: 0 }, NOW)))
      .toContain('implausible_depth')
    expect(validate(placeSounding(setDepth(emptyDraft(), 40), { x: 0, y: 0 }, NOW)))
      .not.toContain('implausible_depth')
  })

  it('passes a finished, timed, plausible draft', () => {
    const d = placeSounding(setDepth(emptyDraft(), 22), { x: 0, y: 0 }, NOW)
    expect(validate(d)).toEqual([])
  })
})

describe('toContribution', () => {
  it('returns null while anything is still wrong', () => {
    expect(toContribution(emptyDraft(), 'site-1')).toBeNull()
  })

  it('packages the draft against its site once it is valid', () => {
    const d = placeSounding(setDepth(emptyDraft(), 22), { x: 3, y: 4 }, NOW)
    const contribution = toContribution(d, 'site-1', { note: 'viz was poor' })!
    expect(contribution.site_id).toBe('site-1')
    expect(contribution.soundings).toHaveLength(1)
    expect(contribution.note).toBe('viz was poor')
  })

  it('attributes the submission to the diver, by display name only', () => {
    const d = placeSounding(setDepth(emptyDraft(), 22), { x: 3, y: 4 }, NOW)
    const contribution = toContribution(d, 'site-1', {
      contributor: { id: 'u1', name: 'Ada' },
    })!
    expect(contribution.contributor).toEqual({ id: 'u1', name: 'Ada' })
    // No email field exists to leak: the type carries a display name only.
    expect(Object.keys(contribution.contributor!)).toEqual(['id', 'name'])
  })
})

describe('withDraft', () => {
  it('previews the map with the draft applied without mutating either', () => {
    const map = baseMap()
    const d = placeSounding(emptyDraft(), { x: 1, y: 1 }, NOW)
    const preview = withDraft(map, d)
    expect(preview.soundings).toHaveLength(1)
    expect(map.soundings).toHaveLength(0)
    expect(contributionCount(d)).toBe(1)
    expect(isEmpty(d)).toBe(false)
  })
})

describe('contributionsByDiver', () => {
  it('counts accepted records by the submission they arrived on', () => {
    const map = { ...baseMap() }
    map.soundings = [
      { id: 'a', at: { x: 0, y: 0 }, depth_m: 6, datum: 'unknown', source: 'diver', contribution_id: 'c1' },
      { id: 'b', at: { x: 1, y: 1 }, depth_m: 8, datum: 'unknown', source: 'diver', contribution_id: 'c1' },
      { id: 'c', at: { x: 2, y: 2 }, depth_m: 9, datum: 'unknown', source: 'diver', contribution_id: 'c2' },
    ]
    map.features = [
      { id: 'f', kind: 'rock', source: 'diver', contribution_id: 'c2',
        geometry: { shape: 'point', at: { x: 0, y: 0 } } },
    ]
    expect(contributionsByDiver(map)).toEqual(new Map([['c1', 2], ['c2', 2]]))
  })

  it('ignores records that predate contribution tracking', () => {
    const map = { ...baseMap() }
    map.soundings = [
      { id: 'a', at: { x: 0, y: 0 }, depth_m: 6, datum: 'unknown', source: 'hand_drawn' },
    ]
    expect(contributionsByDiver(map).size).toBe(0)
  })
})

describe('correcting scaffold points', () => {
  const grid: Sounding[] = [
    { id: 'g1', at: { x: 0, y: 0 }, depth_m: 10, datum: 'unknown', source: 'placeholder' },
    { id: 'g2', at: { x: 20, y: 0 }, depth_m: 10, datum: 'unknown', source: 'placeholder' },
    { id: 'real', at: { x: 40, y: 0 }, depth_m: 14, datum: 'unknown', source: 'diver' },
  ]

  it('snaps a near-miss tap onto the point it was aimed at', () => {
    expect(snapTarget({ x: 2, y: 1 }, grid, 10)?.id).toBe('g1')
  })

  it('takes the nearer point when a tap falls between two', () => {
    expect(snapTarget({ x: 12, y: 0 }, grid, 10)?.id).toBe('g2')
  })

  it('snaps to nothing when the tap is in open water', () => {
    expect(snapTarget({ x: 10, y: 40 }, grid, 10)).toBeNull()
  })

  it('never snaps onto somebody real reading', () => {
    expect(snapTarget({ x: 40, y: 0 }, grid, 10)).toBeNull()
  })

  it('records which scaffold point a correction replaces', () => {
    const d = placeSounding(setDepth(emptyDraft(), 23), { x: 0, y: 0 }, NOW, 'g1')
    expect(d.soundings[0].supersedes).toBe('g1')
    expect(supersededIds(d)).toEqual(new Set(['g1']))
  })

  it('replaces an earlier correction of the same point instead of stacking', () => {
    let d = placeSounding(setDepth(emptyDraft(), 23), { x: 0, y: 0 }, NOW, 'g1')
    d = placeSounding(setDepth(d, 26), { x: 0, y: 0 }, NOW, 'g1')
    expect(d.soundings).toHaveLength(1)
    expect(d.soundings[0].depth_m).toBe(26)
  })

  it('keeps corrections of different points side by side', () => {
    let d = placeSounding(setDepth(emptyDraft(), 23), { x: 0, y: 0 }, NOW, 'g1')
    d = placeSounding(d, { x: 20, y: 0 }, NOW, 'g2')
    expect(d.soundings).toHaveLength(2)
    expect(supersededIds(d)).toEqual(new Set(['g1', 'g2']))
  })

  it('leaves a free-water reading with nothing superseded', () => {
    const d = placeSounding(emptyDraft(), { x: 5, y: 5 }, NOW)
    expect(d.soundings[0].supersedes).toBeUndefined()
    expect(supersededIds(d).size).toBe(0)
  })
})

describe('applyPick', () => {
  it('corrects the point that was tapped', () => {
    const d = applyPick(setDepth(emptyDraft(), 24), { soundingId: 'g1', at: { x: 0, y: 0 } }, NOW)
    expect(d.soundings).toHaveLength(1)
    expect(d.soundings[0]).toMatchObject({ depth_m: 24, supersedes: 'g1' })
  })

  it('ignores a tap that hit no point, rather than dropping a reading in open water', () => {
    const before = setDepth(emptyDraft(), 24)
    expect(applyPick(before, { at: { x: 5, y: 5 } }, NOW)).toEqual(before)
  })

  it('lets the same point be corrected again, replacing the earlier value', () => {
    let d = applyPick(setDepth(emptyDraft(), 24), { soundingId: 'g1', at: { x: 0, y: 0 } }, NOW)
    d = applyPick(setDepth(d, 26), { soundingId: 'g1', at: { x: 0, y: 0 } }, NOW)
    expect(d.soundings).toHaveLength(1)
    expect(d.soundings[0].depth_m).toBe(26)
  })
})
