import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UpdateAvailableBanner } from './UpdateAvailableBanner'

describe('UpdateAvailableBanner', () => {
  it('renders the prompt copy and the single Update action — no dismiss path', () => {
    // Deliberately no Later/dismiss button: an out-of-date PWA can hit a
    // backend that has already migrated past it, so the banner stays loud
    // until the reload happens.
    render(<UpdateAvailableBanner onUpdate={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/new version is available/i)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^update$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /later|dismiss/i })).not.toBeInTheDocument()
  })

  it('clicking Update calls onUpdate', async () => {
    const onUpdate = vi.fn()
    const user = userEvent.setup()
    render(<UpdateAvailableBanner onUpdate={onUpdate} />)
    await user.click(screen.getByRole('button', { name: /^update$/i }))
    expect(onUpdate).toHaveBeenCalledOnce()
  })

  it('uses role="alert" with aria-live so screen readers announce the prompt', () => {
    render(<UpdateAvailableBanner onUpdate={vi.fn()} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('aria-live', 'polite')
  })
})
