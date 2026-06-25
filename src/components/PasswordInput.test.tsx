import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PasswordInput } from './PasswordInput'

describe('PasswordInput', () => {
  it('masks the value by default and toggles visibility with the eye button', async () => {
    const user = userEvent.setup()
    render(<PasswordInput aria-label="Password" defaultValue="hunter2" />)

    const input = screen.getByLabelText('Password', { selector: 'input' }) as HTMLInputElement
    expect(input.type).toBe('password')

    const toggle = screen.getByRole('button', { name: /show password/i })
    await user.click(toggle)
    expect(input.type).toBe('text')
    expect(screen.getByRole('button', { name: /hide password/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /hide password/i }))
    expect(input.type).toBe('password')
  })

  it('forwards native props so it works as a controlled input', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<PasswordInput aria-label="Password" value="" onChange={onChange} placeholder="Password" />)

    await user.type(screen.getByPlaceholderText('Password'), 'a')
    expect(onChange).toHaveBeenCalled()
  })

  it('keeps the eye button out of the tab order', () => {
    render(<PasswordInput aria-label="Password" />)
    expect(screen.getByRole('button', { name: /show password/i })).toHaveAttribute('tabindex', '-1')
  })
})
