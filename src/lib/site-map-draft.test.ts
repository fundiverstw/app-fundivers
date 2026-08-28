import { describe, it, expect } from 'vitest'
import {
  emptyDraft, setTool, setFeatureKind, placeSounding, addVertex,
  canCommitPath, commitPath, undo, contributionCount, isEmpty, validate,
  toContribution, withDraft, contributionsByDiver, MAX_PLAUSIBLE_DEPTH_M,
  markEntry, nameEntry,
} from './site-map-draft'
import type { DiveSiteMap } from './dive-site-map'

const NOW = '2026-08-11T02:15:00Z'

function baseMap(): DiveSiteMap {
  return {
    id: 'site-1', name: 'Site', frame: {}, provenance: { author: 'x' },
    soundings: [], features: [], bearings: [], entries: [],
  }
}

describe('placing soundings', () => {
  it('stamps each one instantaneous, timed, and attributed to the diver', () => {
    const d = placeSounding(emptyDraft(), { x: 4, y: -2 }, 18, NOW)
    expect(d.soundings).toHaveLength(1)
    expect(d.soundings[0]).toMatchObject({
      depth_m: 18, datum: 'instantaneous', observed_at: NOW, source: 'diver',
    })
  })

  // The depth belongs to the gesture that produced it, not to the draft. A
  // draft-wide "current depth" was what made this a matter of arming a number
  // and then aiming at a target.
  it('takes each depth from the placement rather than from a mode', () => {
    let d = placeSounding(emptyDraft(), { x: 0, y: 0 }, 12, NOW)
    d = placeSounding(d, { x: 5, y: 5 }, 12, NOW)
    d = placeSounding(d, { x: 9, y: 9 }, 20, NOW)
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
    let d = placeSounding(emptyDraft(), { x: 0, y: 0 }, 12, NOW)
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
    let d = placeSounding(emptyDraft(), { x: 0, y: 0 }, 12, NOW)
    d = addVertex(setTool(d, 'contour'), { x: 1, y: 1 })
    expect(validate(d)).toContain('unfinished_shape')
  })

  it('rejects a sounding with no time, because it could never be tide-corrected', () => {
    const d = placeSounding(emptyDraft(), { x: 0, y: 0 }, 12, NOW)
    d.soundings[0].observed_at = undefined
    expect(validate(d)).toContain('sounding_without_time')
  })

  it('rejects depths that are impossible rather than merely deep', () => {
    // Zero is the surface, which is where every point starts: a reading there
    // is a grab that was released without going anywhere, not a depth.
    expect(validate(placeSounding(emptyDraft(), { x: 0, y: 0 }, 0, NOW)))
      .toContain('implausible_depth')
    expect(validate(placeSounding(emptyDraft(), { x: 0, y: 0 }, MAX_PLAUSIBLE_DEPTH_M + 1, NOW)))
      .toContain('implausible_depth')
    expect(validate(placeSounding(emptyDraft(), { x: 0, y: 0 }, 40, NOW)))
      .not.toContain('implausible_depth')
  })

  it('passes a finished, timed, plausible draft', () => {
    const d = placeSounding(emptyDraft(), { x: 0, y: 0 }, 22, NOW)
    expect(validate(d)).toEqual([])
  })
})

describe('toContribution', () => {
  it('returns null while anything is still wrong', () => {
    expect(toContribution(emptyDraft(), 'site-1')).toBeNull()
  })

  it('packages the draft against its site once it is valid', () => {
    const d = placeSounding(emptyDraft(), { x: 3, y: 4 }, 22, NOW)
    const contribution = toContribution(d, 'site-1', { note: 'viz was poor' })!
    expect(contribution.site_id).toBe('site-1')
    expect(contribution.soundings).toHaveLength(1)
    expect(contribution.note).toBe('viz was poor')
  })

  it('attributes the submission to the diver, by display name only', () => {
    const d = placeSounding(emptyDraft(), { x: 3, y: 4 }, 22, NOW)
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
    const d = placeSounding(emptyDraft(), { x: 1, y: 1 }, 9, NOW)
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

describe('correcting a point that was already pulled', () => {
  it('records which lattice position a correction replaces', () => {
    const d = placeSounding(emptyDraft(), { x: 0, y: 0 }, 23, NOW, 'lat:0:0')
    expect(d.soundings[0].supersedes).toBe('lat:0:0')
  })

  it('replaces an earlier correction of the same point instead of stacking', () => {
    let d = placeSounding(emptyDraft(), { x: 0, y: 0 }, 23, NOW, 'lat:0:0')
    d = placeSounding(d, { x: 0, y: 0 }, 26, NOW, 'lat:0:0')
    expect(d.soundings).toHaveLength(1)
    expect(d.soundings[0].depth_m).toBe(26)
  })

  it('keeps corrections of different points side by side', () => {
    let d = placeSounding(emptyDraft(), { x: 0, y: 0 }, 23, NOW, 'lat:0:0')
    d = placeSounding(d, { x: 20, y: 0 }, 19, NOW, 'lat:20:0')
    expect(d.soundings).toHaveLength(2)
  })
})


describe('marking ways into the water', () => {
  it('records where a diver got in, attributed like every other observation', () => {
    const d = markEntry(emptyDraft(), { x: 4, y: -2 })
    expect(d.entries).toHaveLength(1)
    expect(d.entries[0]).toMatchObject({ at: { x: 4, y: -2 }, source: 'diver' })
  })

  it('snaps to the lattice, so the id is the place rather than the tap', () => {
    const a = markEntry(emptyDraft(), { x: 4.2, y: -1.9 })
    const b = markEntry(emptyDraft(), { x: 3.8, y: -2.1 })
    expect(a.entries[0].id).toBe(b.entries[0].id)
    expect(a.entries[0].at).toEqual({ x: 4, y: -2 })
  })

  // The gesture that places one is a tap on a point of seabed, and taps land
  // where they were not meant to.
  it('unmarks a point already marked rather than marking it twice', () => {
    const once = markEntry(emptyDraft(), { x: 4, y: -2 })
    const twice = markEntry(once, { x: 4, y: -2 })
    expect(twice.entries).toHaveLength(0)
  })

  it('takes as many as the site has ways in', () => {
    let d = markEntry(emptyDraft(), { x: 0, y: 0 })
    d = markEntry(d, { x: 30, y: 12 })
    d = markEntry(d, { x: -18, y: 4 })
    expect(d.entries).toHaveLength(3)
    expect(new Set(d.entries.map(e => e.id)).size).toBe(3)
  })

  it('names one, because a slipway and a scramble are not interchangeable', () => {
    const d = markEntry(emptyDraft(), { x: 4, y: -2 })
    const named = nameEntry(d, d.entries[0].id, '  Slipway  ')
    expect(named.entries[0].label).toBe('Slipway')
  })

  it('leaves no empty label behind when the name is cleared', () => {
    let d = markEntry(emptyDraft(), { x: 4, y: -2 })
    d = nameEntry(d, d.entries[0].id, 'Steps')
    d = nameEntry(d, d.entries[0].id, '   ')
    expect('label' in d.entries[0]).toBe(false)
  })

  it('is a contribution on its own — a way in is something the site did not know', () => {
    const d = markEntry(emptyDraft(), { x: 4, y: -2 })
    expect(contributionCount(d)).toBe(1)
    expect(isEmpty(d)).toBe(false)
    expect(validate(d)).toEqual([])
    expect(toContribution(d, 'site-1')?.entries).toHaveLength(1)
  })

  it('comes off first on undo, before a reading somebody pulled for', () => {
    let d = placeSounding(emptyDraft(), { x: 0, y: 0 }, 12, NOW)
    d = markEntry(d, { x: 4, y: -2 })
    expect(undo(d).entries).toHaveLength(0)
    expect(undo(d).soundings).toHaveLength(1)
  })

  it('replaces a stored entry on the same spot in the preview, not doubles it', () => {
    const map = baseMap()
    map.entries = [{ id: 'ent:4:-2', at: { x: 4, y: -2 }, label: 'Old name', source: 'hand_drawn' }]
    const d = nameEntry(markEntry(emptyDraft(), { x: 4, y: -2 }), 'ent:4:-2', 'Slipway')
    const preview = withDraft(map, d)
    expect(preview.entries).toHaveLength(1)
    expect(preview.entries[0].label).toBe('Slipway')
  })
})
