import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextField } from './TextField'

describe('TextField', () => {
  it('labels the input by id, so a date field\'s second native input is not claimed', () => {
    render(<TextField label="Date of birth" type="date" value="" onChange={() => {}} />)
    const field = screen.getByLabelText('Date of birth')
    expect(field).toHaveAttribute('type', 'text')
    expect(field.id).toBeTruthy()
  })

  it('renders a maskable password input — the branch the cart flow used to lack', async () => {
    const onChange = vi.fn()
    render(<TextField label="Password" type="password" value="" onChange={onChange} />)
    const field = screen.getByLabelText('Password')
    expect(field).toHaveAttribute('type', 'password')
    await userEvent.type(field, 'a')
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('reports plain text edits as values, not events', async () => {
    const onChange = vi.fn()
    render(<TextField label="Nationality" value="" onChange={onChange} hint="As on your passport" />)
    await userEvent.type(screen.getByLabelText('Nationality'), 'x')
    expect(onChange).toHaveBeenCalledWith('x')
    expect(screen.getByText('As on your passport')).toBeInTheDocument()
  })

  it('marks a field required only when asked', () => {
    const { rerender } = render(<TextField label="Email" type="email" value="" onChange={() => {}} />)
    expect(screen.getByLabelText('Email')).not.toBeRequired()
    rerender(<TextField label="Email" type="email" value="" onChange={() => {}} required />)
    expect(screen.getByLabelText('Email')).toBeRequired()
  })
})
