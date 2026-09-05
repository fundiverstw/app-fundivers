import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminBackupPage } from './AdminBackupPage'
import { ToastProvider } from '../../components/Toast'
import { renderWithRouter } from '../../../tests/test-utils'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}))

// "ZIP" bytes, base64 — the page only has to move them to disk unchanged.
const ZIP_B64 = 'AQID'

let clicked: { download: string; href: string } | null
let revoked: string[]

beforeEach(() => {
  invoke.mockReset()
  clicked = null
  revoked = []
  URL.createObjectURL = vi.fn(() => 'blob:backup')
  URL.revokeObjectURL = vi.fn((url: string) => { revoked.push(url) })
  // Anchor clicks would navigate the test window; record the download instead.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked = { download: this.download, href: this.href }
  })
})

afterEach(() => { vi.restoreAllMocks() })

describe('AdminBackupPage', () => {
  it('downloads the archive the function built, under the name it chose', async () => {
    invoke.mockResolvedValue({
      data: { ok: true, filename: 'fundivers-backup-2026-09-05.zip', table_count: 42, row_count: 1234, zip_base64: ZIP_B64 },
      error: null,
    })
    const user = userEvent.setup()
    renderWithRouter(<AdminBackupPage />)

    await user.click(screen.getByRole('button', { name: /download backup/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('export-database-backup', { body: {} }))
    expect(clicked?.download).toBe('fundivers-backup-2026-09-05.zip')
    expect(clicked?.href).toContain('blob:backup')
    // The blob URL is released once the click has taken it.
    expect(revoked).toEqual(['blob:backup'])
    // The anchor is a means, not a fixture — it must not be left in the page.
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('reports what came back, so an admin can tell a full backup from an empty one', async () => {
    invoke.mockResolvedValue({
      data: { ok: true, filename: 'x.zip', table_count: 42, row_count: 1234, zip_base64: ZIP_B64 },
      error: null,
    })
    const user = userEvent.setup()
    renderWithRouter(<AdminBackupPage />)
    await user.click(screen.getByRole('button', { name: /download backup/i }))

    expect(await screen.findByText(/42 tables/i)).toBeInTheDocument()
    expect(screen.getByText(/1,234 rows/i)).toBeInTheDocument()
  })

  it('says so when the export fails instead of handing over an empty file', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('forbidden') })
    const user = userEvent.setup()
    // Wrapped: the failure is reported through a toast, and a page rendered
    // without the provider swallows it.
    renderWithRouter(<ToastProvider><AdminBackupPage /></ToastProvider>)
    await user.click(screen.getByRole('button', { name: /download backup/i }))

    expect(await screen.findByText(/backup failed/i)).toBeInTheDocument()
    expect(clicked).toBeNull()
  })

  it('warns that the archive carries personal data before anyone downloads it', () => {
    renderWithRouter(<AdminBackupPage />)
    expect(screen.getByText(/personal data/i)).toBeInTheDocument()
    // And is honest that it is not a restore point.
    expect(screen.getByText(/not a restorable database/i)).toBeInTheDocument()
  })
})
