import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SiteMapEditor } from './SiteMapEditor'
import { newSiteMap } from '../../lib/site-seeds'
import { t } from '../../i18n'
import type { Vec2 } from '../../lib/dive-site-map'
import type { GridHandle } from '../../lib/site-map-grid'

type DragEvent = { id: string; at: Vec2; depth_m: number; done: boolean }

const { sceneProps } = vi.hoisted(() => ({
  sceneProps: { current: null as null | {
    handles: readonly GridHandle[]
    onHandleDrag: (e: DragEvent) => void
  } },
}))

// The scene is WebGL and renders nothing under happy-dom. What it contributes
// to this component is a stream of drag events, so the stub exposes exactly
// that and the test drives it the way a finger would.
vi.mock('./DiveSiteScene', () => ({
  DiveSiteScene: (props: { handles: readonly GridHandle[]; onHandleDrag: (e: DragEvent) => void }) => {
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

beforeEach(() => { sceneProps.current = null })

describe('SiteMapEditor', () => {
  it('hands the scene a field of handles to grab', () => {
    renderEditor()
    const handles = sceneProps.current!.handles
    expect(handles.length).toBeGreaterThan(0)
    // Nothing measured yet, so the whole field is scaffold at the flat base.
    expect(handles.every(h => !h.measured)).toBe(true)
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
