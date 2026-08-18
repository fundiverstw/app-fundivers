import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminDiveSitesPage } from './AdminDiveSitesPage'
import { t } from '../../i18n'

const ds = t.admin.diveSites

const sites = [
  { id: 'site-1', name: 'Bat Cave', kind: 'dive', region: 'Longdong', notes: null, active: true },
  { id: 'site-2', name: 'Closed Cove', kind: 'dive', region: null, notes: null, active: false },
]

const fetchDiveSites = vi.fn(async () => sites)
const saveDiveSite = vi.fn(async () => {})
const deleteDiveSite = vi.fn(async () => {})

vi.mock('../../lib/dive-sites', () => ({
  fetchDiveSites: (...a: unknown[]) => fetchDiveSites(...a),
  saveDiveSite: (...a: unknown[]) => saveDiveSite(...a),
  deleteDiveSite: (...a: unknown[]) => deleteDiveSite(...a),
}))

const toast = { success: vi.fn(), error: vi.fn() }
vi.mock('../../hooks/useToast', () => ({ useToast: () => toast }))

describe('AdminDiveSitesPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists the catalog, marking a retired site', async () => {
    render(<AdminDiveSitesPage />)
    expect(await screen.findByText('Bat Cave')).toBeInTheDocument()
    expect(screen.getByText('Longdong')).toBeInTheDocument()
    expect(screen.getByText(t.admin.waivers.inactive)).toBeInTheDocument()
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
