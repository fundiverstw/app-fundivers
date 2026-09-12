import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AdminManagePage } from './AdminManagePage'
import { t } from '../../i18n'

const { fetchPendingCounts } = vi.hoisted(() => ({ fetchPendingCounts: vi.fn() }))
vi.mock('../../lib/admin-pending', () => ({
  fetchPendingCounts: (...a: unknown[]) => fetchPendingCounts(...a),
}))

const m = t.admin.manage

beforeEach(() => {
  fetchPendingCounts.mockReset()
  fetchPendingCounts.mockResolvedValue({})
})

describe('AdminManagePage', () => {
  it('renders a header for every group', () => {
    render(<MemoryRouter><AdminManagePage /></MemoryRouter>)
    for (const title of Object.values(m.groups)) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
  })

  it('links every management page exactly once', () => {
    render(<MemoryRouter><AdminManagePage /></MemoryRouter>)
    const hrefs = screen.getAllByRole('link').map(a => a.getAttribute('href'))
    // Every card, no duplicates — the grouping must not drop or repeat a page.
    expect(new Set(hrefs).size).toBe(hrefs.length)
    expect(hrefs).toContain('/admin/create-diver')
    expect(hrefs).toContain('/admin/dashboard')
    expect(hrefs).toContain('/admin/terms')
    expect(hrefs).toContain('/admin/accounting')
  })

  // The refunds page was reachable only from badges gated on OPEN refund
  // requests, so a cancelled booking the shop still holds money on — which
  // raises no request — was invisible from every admin surface. This tile is
  // the unconditional way in.
  it('links the refunds page unconditionally', () => {
    render(<MemoryRouter><AdminManagePage /></MemoryRouter>)
    const link = screen.getByRole('link', { name: new RegExp(m.refunds.title) })
    expect(link).toHaveAttribute('href', '/admin/refunds')
  })

  describe('what is waiting', () => {
    const cardFor = (href: string) =>
      screen.getAllByRole('link').find(a => a.getAttribute('href') === href)!

    it('puts the count on the card of every page with work waiting', async () => {
      fetchPendingCounts.mockResolvedValue({
        '/admin/refunds': 2,
        '/admin/discounts': 1,
        '/admin/applications': 3,
        '/admin/wildlife': 0,
      })
      render(<MemoryRouter><AdminManagePage /></MemoryRouter>)
      await waitFor(() => expect(within(cardFor('/admin/refunds')).getByText('2')).toBeInTheDocument())
      expect(within(cardFor('/admin/discounts')).getByText('1')).toBeInTheDocument()
      expect(within(cardFor('/admin/applications')).getByText('3')).toBeInTheDocument()
    })

    // A row of zeroes is noise, and the chip only works by being rare enough
    // to notice.
    it('shows nothing on a card with nothing waiting', async () => {
      fetchPendingCounts.mockResolvedValue({ '/admin/refunds': 0, '/admin/discounts': 2 })
      render(<MemoryRouter><AdminManagePage /></MemoryRouter>)
      await waitFor(() => expect(within(cardFor('/admin/discounts')).getByText('2')).toBeInTheDocument())
      expect(within(cardFor('/admin/refunds')).queryByText('0')).not.toBeInTheDocument()
    })

    it('names the page and the number for a screen reader', async () => {
      fetchPendingCounts.mockResolvedValue({ '/admin/discounts': 4 })
      render(<MemoryRouter><AdminManagePage /></MemoryRouter>)
      await waitFor(() => expect(
        screen.getByLabelText(m.waitingAria(4, m.discounts.title)),
      ).toBeInTheDocument())
    })

    // The chips are an extra, not the page: a failed read leaves a working hub.
    it('still renders the grid when the counts cannot be read', async () => {
      fetchPendingCounts.mockRejectedValue(new Error('denied'))
      render(<MemoryRouter><AdminManagePage /></MemoryRouter>)
      expect(await screen.findByRole('link', { name: new RegExp(m.refunds.title) })).toBeInTheDocument()
    })
  })
})
