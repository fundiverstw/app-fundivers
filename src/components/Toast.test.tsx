import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ToastProvider } from './Toast'
import { useToast } from '../hooks/useToast'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function Trigger({ kind, message }: { kind: 'success' | 'error' | 'info'; message: string }) {
  const toast = useToast()
  return <button onClick={() => toast[kind](message)}>fire</button>
}

describe('ToastProvider', () => {
  it('shows a success message and auto-dismisses after 3s', () => {
    render(
      <ToastProvider>
        <Trigger kind="success" message="Saved!" />
      </ToastProvider>
    )

    // Nothing visible initially.
    expect(screen.queryByText('Saved!')).not.toBeInTheDocument()

    // Click → toast appears.
    act(() => { screen.getByText('fire').click() })
    expect(screen.getByText('Saved!')).toBeInTheDocument()

    // Stays visible just before TTL elapses…
    act(() => { vi.advanceTimersByTime(2900) })
    expect(screen.getByText('Saved!')).toBeInTheDocument()

    // …then disappears once the 3s timer fires.
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.queryByText('Saved!')).not.toBeInTheDocument()
  })

  it('stacks multiple concurrent toasts', () => {
    render(
      <ToastProvider>
        <Trigger kind="error" message="First" />
      </ToastProvider>
    )
    const fire = screen.getByText('fire')
    act(() => { fire.click(); fire.click() })
    expect(screen.getAllByText('First')).toHaveLength(2)
  })
})

describe('useToast outside a provider', () => {
  it('returns a no-op API rather than throwing', () => {
    // Renders without ToastProvider — calling toast.* should be silent
    // (this lets unit tests of consumers skip wrapping).
    function Probe() {
      const toast = useToast()
      toast.success('ignored')
      return <span>ok</span>
    }
    render(<Probe />)
    expect(screen.getByText('ok')).toBeInTheDocument()
  })
})
