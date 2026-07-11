import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AdminManagePage } from './AdminManagePage'
import { t } from '../../i18n'

const m = t.admin.manage

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
    expect(hrefs).toContain('/admin/dashboard')
    expect(hrefs).toContain('/admin/terms')
    expect(hrefs).toContain('/admin/accounting')
  })
})
