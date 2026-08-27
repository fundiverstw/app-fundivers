import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminDiveSitesPage } from './AdminDiveSitesPage'
import { t } from '../../i18n'

const ds = t.admin.diveSites

const sites = [
  { id: 'site-1', name: 'Bat Cave', name_zh_tw: '蝙蝠洞', name_ja: null,
    kind: 'dive', region: 'Longdong', notes: null, active: true,
    verified: true, latitude: null, longitude: null, created_by: null },
  { id: 'site-2', name: 'Closed Cove', name_zh_tw: null, name_ja: null,
    kind: 'dive', region: null, notes: null, active: false,
    verified: true, latitude: null, longitude: null, created_by: null },
  { id: 'site-3', name: 'Batcave', name_zh_tw: null, name_ja: null,
    kind: 'dive', region: null, notes: null, active: true,
    verified: false, latitude: null, longitude: null, created_by: 'diver-1' },
]

const fetchDiveSites = vi.fn(async () => sites)
const saveDiveSite = vi.fn(async () => {})
const deleteDiveSite = vi.fn(async () => {})
const verifyDiveSite = vi.fn(async () => {})
const mergeDiveSites = vi.fn(async () => {})

// The network calls are stubbed; siteName and otherSiteNames are pure and
// stubbing them would hide the language fallback the list depends on.
vi.mock('../../lib/dive-sites', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/dive-sites')>()),
  fetchDiveSites: (...a: unknown[]) => fetchDiveSites(...a),
  saveDiveSite: (...a: unknown[]) => saveDiveSite(...a),
  deleteDiveSite: (...a: unknown[]) => deleteDiveSite(...a),
  verifyDiveSite: (...a: unknown[]) => verifyDiveSite(...a),
  mergeDiveSites: (...a: unknown[]) => mergeDiveSites(...a),
}))

const toast = { success: vi.fn(), error: vi.fn() }
vi.mock('../../hooks/useToast', () => ({ useToast: () => toast }))

describe('AdminDiveSitesPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists the catalog, marking a retired site', async () => {
    render(<AdminDiveSitesPage />)
    expect(await screen.findByText('Bat Cave')).toBeInTheDocument()
    // The row carries the place's other names beside its area. The duplicate
    // an admin is hunting is usually the same place under a spelling that
    // sorts nowhere near it, so the names have to be on the row itself.
    expect(screen.getByText(/蝙蝠洞 · Longdong/)).toBeInTheDocument()
    expect(screen.getByText(t.admin.waivers.inactive)).toBeInTheDocument()
  })

  it('badges what a diver added, and offers to confirm it', async () => {
    const user = userEvent.setup()
    render(<AdminDiveSitesPage />)

    const row = (await screen.findByText('Batcave')).closest('li')!
    expect(within(row).getByText(ds.unverifiedBadge)).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: ds.verify }))
    await waitFor(() => expect(verifyDiveSite).toHaveBeenCalledWith('site-3', true))
  })

  // Unverified is a queue, not a fault: the point of the filter is that staff
  // do not have to hunt for what needs a decision.
  it('filters down to the places still needing a decision', async () => {
    const user = userEvent.setup()
    render(<AdminDiveSitesPage />)
    await screen.findByText('Bat Cave')

    await user.click(screen.getByRole('tab', { name: /needs checking/i }))
    expect(screen.getByText('Batcave')).toBeInTheDocument()
    expect(screen.queryByText('Bat Cave')).not.toBeInTheDocument()
  })

  it('merges a duplicate into the place an admin picks to keep', async () => {
    const user = userEvent.setup()
    render(<AdminDiveSitesPage />)

    const row = (await screen.findByText('Batcave')).closest('li')!
    await user.click(within(row).getByRole('button', { name: ds.mergeLabel }))

    // The place being merged away is not offered as its own survivor.
    const picker = screen.getByLabelText(ds.mergePick) as HTMLSelectElement
    expect([...picker.options].map(o => o.value)).not.toContain('site-3')

    await user.selectOptions(picker, 'site-1')
    await user.click(screen.getByRole('button', { name: ds.mergeInto }))
    await waitFor(() => expect(mergeDiveSites).toHaveBeenCalledWith('site-1', 'site-3'))
  })

  it('saves the names in every language and the coordinates', async () => {
    const user = userEvent.setup()
    render(<AdminDiveSitesPage />)
    await user.click(await screen.findByRole('button', { name: ds.newSite }))

    await user.type(screen.getByLabelText(ds.nameLabel), 'Dragon Head')
    await user.type(screen.getByLabelText(ds.nameZhLabel), '龍頭')
    await user.type(screen.getByLabelText(ds.latitudeLabel), '25.1')
    await user.type(screen.getByLabelText(ds.longitudeLabel), '121.9')
    await user.click(screen.getByRole('button', { name: t.admin.waivers.save }))

    await waitFor(() => expect(saveDiveSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Dragon Head', name_zh_tw: '龍頭', latitude: 25.1, longitude: 121.9 }),
      undefined,
    ))
  })

  it('refuses half a coordinate', async () => {
    const user = userEvent.setup()
    render(<AdminDiveSitesPage />)
    await user.click(await screen.findByRole('button', { name: ds.newSite }))

    await user.type(screen.getByLabelText(ds.nameLabel), 'Half Located')
    await user.type(screen.getByLabelText(ds.latitudeLabel), '25.1')
    await user.click(screen.getByRole('button', { name: t.admin.waivers.save }))

    expect(toast.error).toHaveBeenCalledWith(ds.coordsBoth)
    expect(saveDiveSite).not.toHaveBeenCalled()
  })

  it('creates a site with its kind', async () => {
    const user = userEvent.setup()
    render(<AdminDiveSitesPage />)
    await user.click(await screen.findByRole('button', { name: ds.newSite }))

    await user.type(screen.getByLabelText(ds.nameLabel), 'Dragon Head')
    await user.selectOptions(screen.getByLabelText(ds.kindLabel), 'adventure')
    await user.click(screen.getByRole('button', { name: t.admin.waivers.save }))

    await waitFor(() => expect(saveDiveSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Dragon Head', kind: 'adventure', active: true }),
      undefined,
    ))
  })

  it('refuses to save a site with no name', async () => {
    const user = userEvent.setup()
    render(<AdminDiveSitesPage />)
    await user.click(await screen.findByRole('button', { name: ds.newSite }))
    await user.click(screen.getByRole('button', { name: t.admin.waivers.save }))

    expect(saveDiveSite).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(ds.nameRequired)
  })

  it('confirms before deleting', async () => {
    const user = userEvent.setup()
    render(<AdminDiveSitesPage />)
    await user.click((await screen.findAllByRole('button', { name: t.admin.waivers.delete }))[0])

    expect(screen.getByText(ds.deleteBody('Bat Cave'))).toBeInTheDocument()
    expect(deleteDiveSite).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: t.admin.waivers.delete }))
    await waitFor(() => expect(deleteDiveSite).toHaveBeenCalledWith('site-1'))
  })
})
