import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SiteMapEditor } from './SiteMapEditor'
import { newSiteMap } from '../../lib/site-seeds'
import { t } from '../../i18n'
import type { DiveSiteMap, Vec2 } from '../../lib/dive-site-map'
import { PATCH_M, type GridHandle } from '../../lib/site-map-grid'

type DragEvent = { id: string; at: Vec2; depth_m: number; done: boolean }

interface SceneProps {
  map: DiveSiteMap
  handles: readonly GridHandle[]
  onHandleDrag: (e: DragEvent) => void
  onHandleMark: (h: GridHandle) => void
  gesture: 'pull' | 'mark' | 'select'
  selected?: ReadonlySet<string>
  onHandleSelect: (h: GridHandle) => void
  onSelectBox: (ids: string[]) => void
}

const { sceneProps } = vi.hoisted(() => ({
  sceneProps: { current: null as null | SceneProps },
}))

// The scene is WebGL and renders nothing under happy-dom. What it contributes
// to this component is a stream of drag, tap and selection events, so the stub
// exposes exactly that and the test drives it the way a finger would.
vi.mock('./DiveSiteScene', () => ({
  DiveSiteScene: (props: SceneProps) => {
    sceneProps.current = props
    return <div data-testid="scene" />
  },
}))

const sm = t.siteMap
const map = { ...newSiteMap('s1', 'Test Site'), extent_m: 20 }
const NOW = '2026-08-27T09:00:00Z'

function renderEditor(onSubmit = vi.fn()) {
  render(<SiteMapEditor map={map} onSubmit={onSubmit} now={() => NOW} />)
  return onSubmit
}

/** One pull: the scene reports continuously, then once more on release.
 *  Wrapped in act because the real caller is a pointer event outside React. */
function pull(id: string, at: Vec2, to: number, frames = [12, 18]) {
  act(() => {
    const drag = sceneProps.current!.onHandleDrag
    for (const depth_m of frames) drag({ id, at, depth_m, done: false })
    drag({ id, at, depth_m: to, done: true })
  })
}

function moveTo(id: string, at: Vec2, depth_m: number) {
  act(() => sceneProps.current!.onHandleDrag({ id, at, depth_m, done: false }))
}

/** One tap in entry mode. The scene reports the handle; what it means is the
 *  draft's business, which is the thing under test. */
function tap(at: Vec2) {
  act(() => sceneProps.current!.onHandleMark({
    id: `lat:${at.x}:${at.y}`, at, depth_m: 0, measured: false,
  }))
}

/** One tap in select mode, on the handle the scene picked. */
function tapSelect(at: Vec2) {
  const id = `lat:${at.x}:${at.y}`
  const handle = sceneProps.current!.handles.find(h => h.id === id)
    ?? { id, at, depth_m: 0, measured: false }
  act(() => sceneProps.current!.onHandleSelect(handle))
}

/** One box dragged round a stretch of seabed. Which handles it enclosed is the
 *  scene's arithmetic (`withinBox`); what the editor does with them is here. */
function boxSelect(...ids: string[]) {
  act(() => sceneProps.current!.onSelectBox(ids))
}

beforeEach(() => { sceneProps.current = null })

describe('SiteMapEditor', () => {
  it('hands the scene a field of handles to grab', () => {
    renderEditor()
    const handles = sceneProps.current!.handles
    expect(handles.length).toBeGreaterThan(0)
    // Nothing measured yet, so the whole field is scaffold at the flat base.
    expect(handles.every(h => !h.measured)).toBe(true)
  })

  // Nothing on an unedited site pretends to be seabed: it is a sheet of water,
  // and every metre of bottom exists only where somebody pulled one down.
  it('starts the whole field at the surface, with nothing to be shaped from', () => {
    renderEditor()
    expect(sceneProps.current!.handles.every(h => h.depth_m === 0)).toBe(true)
  })

  // The scene drops a grab that went nowhere, but if one ever reaches the
  // draft it must not be submittable: the surface is where the point started,
  // not a depth anybody read.
  it('will not submit a reading left at the surface', () => {
    renderEditor()
    pull('lat:4:6', { x: 4, y: 6 }, 0, [])
    expect(screen.getByText(sm.problemDepth)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: sm.submit })).toBeDisabled()
  })

  // The point of the rewrite: the depth comes out of the gesture, so nobody
  // types a number before touching the seabed.
  it('records a reading from the pull itself, on release', () => {
    renderEditor()
    expect(screen.getByText(sm.draftCount(0))).toBeInTheDocument()

    pull('lat:4:6', { x: 4, y: 6 }, 24.3)

    expect(screen.getByText(sm.draftCount(1))).toBeInTheDocument()
  })

  it('records nothing while the finger is still moving', () => {
    renderEditor()
    moveTo('lat:4:6', { x: 4, y: 6 }, 18)
    expect(screen.getByText(sm.draftCount(0))).toBeInTheDocument()
  })

  it('shows the depth under the finger as it moves', () => {
    renderEditor()
    const field = screen.getByLabelText(sm.depthField) as HTMLInputElement
    expect(field.value).toBe('')

    moveTo('lat:4:6', { x: 4, y: 6 }, 18.4)
    expect((screen.getByLabelText(sm.depthField) as HTMLInputElement).value).toBe('18.4')
  })

  it('puts the pulled point back into the field to grab again, now measured', () => {
    renderEditor()
    pull('lat:4:6', { x: 4, y: 6 }, 24.3)

    const pulled = sceneProps.current!.handles.find(h => h.id === 'lat:4:6')!
    expect(pulled).toMatchObject({ depth_m: 24.3, measured: true })
  })

  it('corrects the same point rather than stacking a second reading on it', () => {
    renderEditor()
    pull('lat:4:6', { x: 4, y: 6 }, 24.3)
    pull('lat:4:6', { x: 4, y: 6 }, 26)

    expect(screen.getByText(sm.draftCount(1))).toBeInTheDocument()
    expect(sceneProps.current!.handles.find(h => h.id === 'lat:4:6')!.depth_m).toBe(26)
  })

  // A diver who read 24.3 off a computer should not have to find it with a
  // finger — but the field corrects the point just pulled, rather than arming
  // a value for the next tap, which was the old behaviour.
  it('lets the figure be typed to correct the point just pulled', async () => {
    const user = userEvent.setup()
    renderEditor()
    pull('lat:4:6', { x: 4, y: 6 }, 24)

    const field = screen.getByLabelText(sm.depthField)
    await user.clear(field)
    await user.type(field, '31.5')

    expect(sceneProps.current!.handles.find(h => h.id === 'lat:4:6')!.depth_m).toBe(31.5)
    expect(screen.getByText(sm.draftCount(1))).toBeInTheDocument()
  })

  it('leaves the field alone until something has been pulled', () => {
    renderEditor()
    expect(screen.getByLabelText(sm.depthField)).toBeDisabled()
  })

  it('will not submit an empty contribution', async () => {
    const user = userEvent.setup()
    const onSubmit = renderEditor()

    expect(screen.getByRole('button', { name: sm.submit })).toBeDisabled()
    pull('lat:4:6', { x: 4, y: 6 }, 24.3)
    await user.click(screen.getByRole('button', { name: sm.submit }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const contribution = onSubmit.mock.calls[0][0]
    expect(contribution.soundings).toHaveLength(1)
    expect(contribution.soundings[0]).toMatchObject({
      depth_m: 24.3, datum: 'instantaneous', observed_at: NOW, source: 'diver',
      supersedes: 'lat:4:6',
    })
  })

  it('starts clean after a submission, rather than re-offering what was sent', async () => {
    const user = userEvent.setup()
    renderEditor()
    pull('lat:4:6', { x: 4, y: 6 }, 24.3)
    await user.click(screen.getByRole('button', { name: sm.submit }))

    expect(screen.getByText(sm.draftCount(0))).toBeInTheDocument()
    expect(screen.getByLabelText(sm.depthField)).toBeDisabled()
  })

  it('takes back the last pull on undo', async () => {
    const user = userEvent.setup()
    renderEditor()
    pull('lat:4:6', { x: 4, y: 6 }, 24.3)
    pull('lat:8:8', { x: 8, y: 8 }, 12)
    expect(screen.getByText(sm.draftCount(2))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: sm.undo }))
    expect(screen.getByText(sm.draftCount(1))).toBeInTheDocument()
  })

  it('tells the diver how the gesture works, since nothing on screen says so', () => {
    renderEditor()
    expect(screen.getByText(sm.hintDrag)).toBeInTheDocument()
  })
})

describe('SiteMapEditor — one metre, and room to grow', () => {
  it('says what a point is worth, on the screen where the pulling happens', () => {
    renderEditor()
    expect(screen.getByText(t.siteMap.handleSpacing(1))).toBeInTheDocument()
  })

  it('spaces the field it hands the scene one metre apart', () => {
    renderEditor()
    const xs = [...new Set(sceneProps.current!.handles.map(h => h.at.x))].sort((a, b) => a - b)
    expect(xs.length).toBeGreaterThan(1)
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBe(1)
  })

  it('starts as one patch, not a canvas with the dive in a corner of it', () => {
    renderEditor()
    const ys = sceneProps.current!.handles.map(h => h.at.y)
    expect(Math.max(...ys)).toBe(PATCH_M / 2)
    expect(Math.min(...ys)).toBe(-PATCH_M / 2)
  })

  it.each([
    ['north', (h: GridHandle[]) => Math.max(...h.map(x => x.at.y)), PATCH_M / 2 + PATCH_M],
    ['south', (h: GridHandle[]) => Math.min(...h.map(x => x.at.y)), -PATCH_M / 2 - PATCH_M],
    ['east', (h: GridHandle[]) => Math.max(...h.map(x => x.at.x)), PATCH_M / 2 + PATCH_M],
    ['west', (h: GridHandle[]) => Math.min(...h.map(x => x.at.x)), -PATCH_M / 2 - PATCH_M],
  ])('adds a flat patch to the %s', async (direction, edgeOf, expected) => {
    const user = userEvent.setup()
    renderEditor()
    const label = t.siteMap[`extend${direction[0].toUpperCase()}${direction.slice(1)}` as 'extendNorth']

    await user.click(screen.getByRole('button', { name: label }))

    const handles = [...sceneProps.current!.handles]
    expect(edgeOf(handles)).toBe(expected)
    // Flat and unedited: extending gives ground to pull at, not readings.
    expect(handles.every(h => !h.measured)).toBe(true)
  })

  it('records nothing by extending — an empty patch is not data', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: t.siteMap.extendNorth }))
    expect(screen.getByText(sm.draftCount(0))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: sm.submit })).toBeDisabled()
  })

  it('keeps extending the same edge, a patch at a time', async () => {
    const user = userEvent.setup()
    renderEditor()
    const north = screen.getByRole('button', { name: t.siteMap.extendNorth })
    await user.click(north)
    await user.click(north)
    expect(Math.max(...sceneProps.current!.handles.map(h => h.at.y)))
      .toBe(PATCH_M / 2 + 2 * PATCH_M)
  })

  it('lets a point on the new ground be pulled like any other', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: t.siteMap.extendNorth }))

    const far = { x: 0, y: PATCH_M / 2 + PATCH_M }
    pull(`lat:${far.x}:${far.y}`, far, 21.5)

    expect(screen.getByText(sm.draftCount(1))).toBeInTheDocument()
    expect(sceneProps.current!.handles.find(h => h.at.y === far.y && h.at.x === 0))
      .toMatchObject({ depth_m: 21.5, measured: true })
  })
})


// A site has as many ways in as it has: a slipway, a set of steps, a gap in
// the rocks that only works at low water. Which one was used decides what the
// rest of the dive looks like, so it is a thing to record, not a preference.
describe('SiteMapEditor — designating a way into the water', () => {
  async function armEntries() {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: sm.toolEntries }))
    return user
  }

  it('tells the scene that a tap now means a place, not a depth', async () => {
    renderEditor()
    expect(sceneProps.current!.gesture).toBe('pull')
    await armEntries()
    expect(sceneProps.current!.gesture).toBe('mark')
  })

  it('records the point tapped as an entry', async () => {
    renderEditor()
    await armEntries()
    tap({ x: 4, y: -2 })

    expect(screen.getByText(sm.draftCount(1))).toBeInTheDocument()
    expect(screen.getByText(sm.entryAt(4, -2))).toBeInTheDocument()
  })

  it('takes several, because a site has several', async () => {
    renderEditor()
    await armEntries()
    tap({ x: 4, y: -2 })
    tap({ x: -6, y: 8 })

    expect(screen.getByText(sm.draftCount(2))).toBeInTheDocument()
    expect(screen.getByText(sm.entryAt(4, -2))).toBeInTheDocument()
    expect(screen.getByText(sm.entryAt(-6, 8))).toBeInTheDocument()
  })

  it('takes a mis-tap back when the same point is tapped again', async () => {
    renderEditor()
    await armEntries()
    tap({ x: 4, y: -2 })
    tap({ x: 4, y: -2 })

    expect(screen.getByText(sm.draftCount(0))).toBeInTheDocument()
  })

  it('names one, so a diver knows which way in is which', async () => {
    renderEditor()
    const user = await armEntries()
    tap({ x: 4, y: -2 })

    await user.type(screen.getByLabelText(sm.entryLabelAria(sm.entryAt(4, -2))), 'Slipway')

    expect(screen.getByRole('button', { name: sm.submit })).toBeEnabled()
  })

  it('submits an entry on its own, with no depth attached to it', async () => {
    const onSubmit = renderEditor()
    const user = await armEntries()
    tap({ x: 4, y: -2 })
    await user.type(screen.getByLabelText(sm.entryLabelAria(sm.entryAt(4, -2))), 'Slipway')
    await user.click(screen.getByRole('button', { name: sm.submit }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const contribution = onSubmit.mock.calls[0][0]
    expect(contribution.soundings).toHaveLength(0)
    expect(contribution.entries).toEqual([
      expect.objectContaining({ at: { x: 4, y: -2 }, label: 'Slipway', source: 'diver' }),
    ])
  })

  it('unmarks one from the list without hunting for it in the water', async () => {
    renderEditor()
    const user = await armEntries()
    tap({ x: 4, y: -2 })
    await user.click(screen.getByRole('button', { name: sm.entryRemove }))

    expect(screen.getByText(sm.draftCount(0))).toBeInTheDocument()
  })

  // The depth field corrects the point last pulled. In entry mode there is no
  // such point, and a stale figure sitting there invites a correction nobody
  // asked for.
  it('puts the depth field away while entries are being marked', async () => {
    renderEditor()
    expect(screen.getByLabelText(sm.depthField)).toBeInTheDocument()
    await armEntries()
    expect(screen.queryByLabelText(sm.depthField)).not.toBeInTheDocument()
  })

  it('says what the tap does, since the gesture changed under the diver', async () => {
    renderEditor()
    await armEntries()
    expect(screen.getByText(sm.hintMarkEntry)).toBeInTheDocument()
    expect(screen.queryByText(sm.hintDrag)).not.toBeInTheDocument()
  })
})


// Most of a real dive is flat: a sand bottom at 8 m, a ledge at 12. Pulling
// four hundred points to the same figure one at a time is the reason nobody
// would fill in a site, so a diver says it once for the stretch they swam.
describe('SiteMapEditor — setting a stretch of seabed at once', () => {
  async function armSelect() {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: sm.toolSelect }))
    return user
  }

  it('tells the scene that a drag now gathers points instead of pulling one', async () => {
    renderEditor()
    expect(sceneProps.current!.gesture).toBe('pull')
    await armSelect()
    expect(sceneProps.current!.gesture).toBe('select')
  })

  it('says what the gesture does, since it changed under the diver', async () => {
    renderEditor()
    await armSelect()
    expect(screen.getByText(sm.hintSelect)).toBeInTheDocument()
    expect(screen.queryByText(sm.hintDrag)).not.toBeInTheDocument()
  })

  it('holds what a tap picks, and lets the same tap put it back', async () => {
    renderEditor()
    await armSelect()

    tapSelect({ x: 0, y: 0 })
    expect(screen.getByText(sm.selectedCount(1))).toBeInTheDocument()
    expect(sceneProps.current!.selected!.has('lat:0:0')).toBe(true)

    tapSelect({ x: 0, y: 0 })
    expect(screen.queryByText(sm.selectedCount(1))).not.toBeInTheDocument()
  })

  // A ledge is often two or three boxes from different angles, and starting
  // over each time would make the second box undo the first.
  it('adds a box to what is already held rather than replacing it', async () => {
    renderEditor()
    await armSelect()
    boxSelect('lat:0:0', 'lat:1:0')
    boxSelect('lat:1:0', 'lat:2:0')

    expect(screen.getByText(sm.selectedCount(3))).toBeInTheDocument()
  })

  it('records the typed depth at every selected point, in one act', async () => {
    const onSubmit = renderEditor()
    const user = await armSelect()
    boxSelect('lat:0:0', 'lat:1:0', 'lat:2:0')

    await user.type(screen.getByLabelText(sm.depthFieldMany(3)), '12')
    expect(screen.getByText(sm.draftCount(3))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: sm.submit }))
    const contribution = onSubmit.mock.calls[0][0]
    expect(contribution.soundings).toHaveLength(3)
    expect(contribution.soundings.every((s: { depth_m: number }) => s.depth_m === 12)).toBe(true)
    expect(contribution.soundings.map((s: { supersedes: string }) => s.supersedes))
      .toEqual(['lat:0:0', 'lat:1:0', 'lat:2:0'])
  })

  it('offers the typed field with nothing pulled, once something is selected', async () => {
    renderEditor()
    await armSelect()
    expect(screen.getByLabelText(sm.depthField)).toBeDisabled()
    boxSelect('lat:0:0')
    expect(screen.getByLabelText(sm.depthFieldMany(1))).toBeEnabled()
  })

  // Pulling one of them is a statement about all of them: that is what having
  // them selected means.
  it('carries a pull on a selected point across the whole selection', async () => {
    renderEditor()
    await armSelect()
    boxSelect('lat:0:0', 'lat:1:0', 'lat:2:0')

    pull('lat:1:0', { x: 1, y: 0 }, 12)

    expect(screen.getByText(sm.draftCount(3))).toBeInTheDocument()
    const handles = sceneProps.current!.handles
    for (const id of ['lat:0:0', 'lat:1:0', 'lat:2:0']) {
      expect(handles.find(h => h.id === id)).toMatchObject({ depth_m: 12, measured: true })
    }
  })

  it('leaves the selection alone when a point outside it is pulled', async () => {
    renderEditor()
    await armSelect()
    boxSelect('lat:0:0', 'lat:1:0')

    pull('lat:9:9', { x: 9, y: 9 }, 30)

    expect(screen.getByText(sm.draftCount(1))).toBeInTheDocument()
    expect(sceneProps.current!.handles.find(h => h.id === 'lat:0:0')!.measured).toBe(false)
  })

  it('takes the whole stretch back in one undo, not one press per point', async () => {
    renderEditor()
    const user = await armSelect()
    boxSelect('lat:0:0', 'lat:1:0', 'lat:2:0')
    await user.type(screen.getByLabelText(sm.depthFieldMany(3)), '12')
    expect(screen.getByText(sm.draftCount(3))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: sm.undo }))
    expect(screen.getByText(sm.draftCount(0))).toBeInTheDocument()
  })

  it('lets the selection go without touching what was recorded from it', async () => {
    renderEditor()
    const user = await armSelect()
    boxSelect('lat:0:0', 'lat:1:0')
    await user.type(screen.getByLabelText(sm.depthFieldMany(2)), '12')

    await user.click(screen.getByRole('button', { name: sm.clearSelection }))

    expect(screen.queryByText(sm.selectedCount(2))).not.toBeInTheDocument()
    expect(screen.getByText(sm.draftCount(2))).toBeInTheDocument()
  })

  it('clears the selection with the draft when a submission goes', async () => {
    renderEditor()
    const user = await armSelect()
    boxSelect('lat:0:0')
    await user.type(screen.getByLabelText(sm.depthFieldMany(1)), '12')
    await user.click(screen.getByRole('button', { name: sm.submit }))

    expect(screen.queryByText(sm.selectedCount(1))).not.toBeInTheDocument()
  })

  it('puts the selecting away while entries are being marked', async () => {
    renderEditor()
    const user = await armSelect()
    await user.click(screen.getByRole('button', { name: sm.toolEntries }))
    expect(sceneProps.current!.gesture).toBe('mark')
  })
})

// An empty site is honest and is also a blank page. A base route is the shape
// a shore dive, a wall or a sand flat usually has, laid under the field so the
// work starts as correcting a shape rather than building one.
describe('SiteMapEditor — starting from a base route', () => {
  async function choose(name: string) {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name }))
    return user
  }

  it('offers the shapes, and flat water as the way out of them', () => {
    renderEditor()
    expect(screen.getByRole('button', { name: sm.routes.shore_slope })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: sm.routes.wall })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: sm.routes.sandy_flat })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: sm.routes.gully })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: sm.routeNone })).toBeInTheDocument()
  })

  it('lays the shape under the field instead of the flat sheet of water', async () => {
    renderEditor()
    expect(sceneProps.current!.handles.every(h => h.depth_m === 0)).toBe(true)

    await choose(sm.routes.sandy_flat)

    expect(sceneProps.current!.handles.every(h => h.depth_m === 8)).toBe(true)
  })

  it('brings its own ground, so nobody extends onto a shape they already picked', async () => {
    renderEditor()
    await choose(sm.routes.shore_slope)

    const ys = sceneProps.current!.handles.map(h => h.at.y)
    expect(Math.min(...ys)).toBe(-30)
    expect(Math.max(...ys)).toBe(30)
  })

  // The whole point: a shape is scaffolding. A diver who picks one and submits
  // nothing has contributed nothing.
  it('records nothing by being picked', async () => {
    renderEditor()
    await choose(sm.routes.wall)

    expect(screen.getByText(sm.draftCount(0))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: sm.submit })).toBeDisabled()
    expect(sceneProps.current!.handles.every(h => !h.measured)).toBe(true)
  })

  it('suggests where you would get in, as a suggestion and not a record', async () => {
    renderEditor()
    await choose(sm.routes.shore_slope)

    const entries = sceneProps.current!.map.entries
    expect(entries).toEqual([expect.objectContaining({ source: 'placeholder' })])
    // Nothing in the draft, so nothing in the count and nothing to submit.
    expect(screen.getByText(sm.draftCount(0))).toBeInTheDocument()
  })

  it('takes the shape away again, back to flat water', async () => {
    renderEditor()
    const user = await choose(sm.routes.sandy_flat)
    await user.click(screen.getByRole('button', { name: sm.routeNone }))

    expect(sceneProps.current!.handles.every(h => h.depth_m === 0)).toBe(true)
    expect(sceneProps.current!.map.entries).toEqual([])
  })

  it('lets a point of the shape be pulled to what was really read there', async () => {
    const onSubmit = vi.fn()
    render(<SiteMapEditor map={map} onSubmit={onSubmit} now={() => NOW} />)
    await userEvent.setup().click(screen.getByRole('button', { name: sm.routes.sandy_flat }))

    pull('lat:0:0', { x: 0, y: 0 }, 9.4)

    expect(sceneProps.current!.handles.find(h => h.id === 'lat:0:0'))
      .toMatchObject({ depth_m: 9.4, measured: true })
    expect(screen.getByText(sm.draftCount(1))).toBeInTheDocument()
  })

  // A shape laid under somebody else's measurements is not scaffolding any
  // more, so it is offered while there is nothing to start from and not after.
  it('is not offered on a site that already holds readings', () => {
    const measured = {
      ...map,
      soundings: [{
        id: 's1', at: { x: 0, y: 0 }, depth_m: 12, datum: 'instantaneous' as const,
        observed_at: NOW, source: 'diver' as const,
      }],
    }
    render(<SiteMapEditor map={measured} onSubmit={vi.fn()} now={() => NOW} />)

    expect(screen.queryByRole('button', { name: sm.routes.wall })).not.toBeInTheDocument()
  })
})
