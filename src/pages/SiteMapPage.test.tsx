import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SiteMapPage } from './SiteMapPage'
import { t } from '../i18n'

const { fetchDiveSites, fetchSiteMap, submitContribution, toast } = vi.hoisted(() => ({
  fetchDiveSites: vi.fn(),
  fetchSiteMap: vi.fn(),
  submitContribution: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('../lib/dive-sites', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/dive-sites')>()),
  fetchDiveSites: () => fetchDiveSites(),
}))
vi.mock('../lib/site-map-store', () => ({
  fetchSiteMap: (...a: unknown[]) => fetchSiteMap(...a),
  submitSiteMapContribution: (...a: unknown[]) => submitContribution(...a),
}))
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }))
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'd1', name: 'Ada Lovelace', nickname: null } }),
}))
// The scene is WebGL and the editor is a canvas; neither renders under
// happy-dom, and neither is what this page is responsible for.
vi.mock('../components/divesites/DiveSiteScene', () => ({
  DiveSiteScene: () => <div data-testid="scene" />,
}))
vi.mock('../components/divesites/SiteMapEditor', () => ({
  SiteMapEditor: ({ onSubmit }: { onSubmit?: (c: unknown) => void }) => (
    <button type="button" onClick={() => onSubmit?.({ soundings: [{ id: 'lat:1:1' }], features: [] })}>
      file
    </button>
  ),
}))

const sites = [
  { id: 's1', name: 'Bat Cave', name_zh_tw: '蝙蝠洞', name_ja: null, kind: 'dive',
    region: 'Keelung', notes: null, active: true, verified: true,
    latitude: null, longitude: null, created_by: null },
  { id: 's2', name: 'Retired Cove', name_zh_tw: null, name_ja: null, kind: 'dive',
    region: null, notes: null, active: false, verified: true,
    latitude: null, longitude: null, created_by: null },
]

const emptyMap = {
  id: 's1', name: 'Bat Cave', frame: {}, provenance: { author: '' },
  soundings: [], features: [], bearings: [], entries: [],
}

const sm = t.siteMaps

beforeEach(() => {
  fetchDiveSites.mockReset().mockResolvedValue(sites)
  fetchSiteMap.mockReset().mockResolvedValue(emptyMap)
  submitContribution.mockReset().mockResolvedValue('c1')
  toast.success.mockReset()
  toast.error.mockReset()
})

describe('SiteMapPage', () => {
  it('offers the catalog, retired places excluded, and opens the first one', async () => {
    render(<SiteMapPage />)

    const picker = await screen.findByLabelText(sm.place) as HTMLSelectElement
    expect([...picker.options].map(o => o.value)).toEqual(['s1'])
    await waitFor(() => expect(fetchSiteMap).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1' }),
    ))
  })

  // A place nobody has measured is the ordinary case, not a failure, and a
  // blank canvas otherwise reads as something that did not load.
  it('says plainly that an unmeasured place has nothing on it yet', async () => {
    render(<SiteMapPage />)
    expect(await screen.findByText(sm.coverage(0, 0))).toBeInTheDocument()
  })

  it('counts only what somebody measured, not the starting scaffold', async () => {
    fetchSiteMap.mockResolvedValue({
      ...emptyMap,
      soundings: [
        { id: 'a', at: { x: 0, y: 0 }, depth_m: 5, datum: 'instantaneous', source: 'diver' },
        { id: 'b', at: { x: 1, y: 1 }, depth_m: 0, datum: 'unknown', source: 'placeholder' },
      ],
    })
    render(<SiteMapPage />)
    expect(await screen.findByText(sm.coverage(1, 0))).toBeInTheDocument()
  })

  it('files a contribution and re-reads, rather than trusting its own copy', async () => {
    const user = userEvent.setup()
    render(<SiteMapPage />)
    await screen.findByLabelText(sm.place)

    await user.click(await screen.findByRole('button', { name: 'file' }))

    await waitFor(() => expect(submitContribution).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 's1' }),
    ))
    // Twice: once on open, once after filing. The lattice reconciles a reading
    // against whatever was already on that square metre, and only the database
    // knows what survived.
    await waitFor(() => expect(fetchSiteMap).toHaveBeenCalledTimes(2))
    expect(toast.success).toHaveBeenCalledWith(sm.filed)
  })

  it('says so when filing fails, and does not claim the readings landed', async () => {
    submitContribution.mockRejectedValue(new Error('offline'))
    const user = userEvent.setup()
    render(<SiteMapPage />)
    await screen.findByLabelText(sm.place)

    await user.click(await screen.findByRole('button', { name: 'file' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(sm.filingFailed('offline')))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('switches between contributing and looking at the surface', async () => {
    const user = userEvent.setup()
    render(<SiteMapPage />)
    // The views appear with the map, not with the picker.
    await user.click(await screen.findByRole('tab', { name: sm.tabSurface }))
    expect(await screen.findByTestId('scene')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'file' })).not.toBeInTheDocument()
  })

  it('points a diver at the almanac when the catalog is empty', async () => {
    fetchDiveSites.mockResolvedValue([])
    render(<SiteMapPage />)
    expect(await screen.findByText(sm.noPlaces)).toBeInTheDocument()
  })
})
