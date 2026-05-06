import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, Navigate } from 'react-router-dom'
import { RecordsPage } from './RecordsPage'

function routedRender(start = '/records') {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/records" element={<RecordsPage />}>
          <Route index element={<Navigate to="bookings" replace />} />
          <Route path="bookings" element={<div>BOOK</div>} />
          <Route path="payments" element={<div>PAY</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('RecordsPage', () => {
  it('renders both sub-tab links', () => {
    routedRender()
    expect(screen.getByRole('link', { name: /bookings/i })).toHaveAttribute('href', '/records/bookings')
    expect(screen.getByRole('link', { name: /payments/i })).toHaveAttribute('href', '/records/payments')
  })

  it('redirects /records to /records/bookings (the index)', () => {
    // The index Navigate is what makes the bottom-nav "Records" tab land on
    // a real page rather than an empty shell.
    routedRender('/records')
    expect(screen.getByText('BOOK')).toBeInTheDocument()
  })

  it('renders the Payments sub-page when on /records/payments', () => {
    routedRender('/records/payments')
    expect(screen.getByText('PAY')).toBeInTheDocument()
    expect(screen.queryByText('BOOK')).not.toBeInTheDocument()
  })

  it('marks the active tab so users can see which sub-page they are on', async () => {
    routedRender('/records/payments')
    // NavLink applies aria-current="page" to the active link by default.
    const payments = screen.getByRole('link', { name: /payments/i })
    expect(payments).toHaveAttribute('aria-current', 'page')
    const bookings = screen.getByRole('link', { name: /bookings/i })
    expect(bookings).not.toHaveAttribute('aria-current')

    // Switching tabs swaps the rendered sub-page and the active link.
    const user = userEvent.setup()
    await user.click(bookings)
    expect(screen.getByText('BOOK')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /bookings/i })).toHaveAttribute('aria-current', 'page')
  })
})
