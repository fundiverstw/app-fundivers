import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { act } from 'react'

// tests/setup.unit.ts replaces this widget globally with a stub that hands
// every caller a token instantly, so the rest of the suite can walk past the
// captcha. This is the one file that wants the real thing.
vi.unmock('./TurnstileWidget')

import { TurnstileWidget } from './TurnstileWidget'

// Scope note. The widget memoizes its script-load promise at module scope, so
// one file gets one outcome for "did challenges.cloudflare.com answer" — and
// resetting the module registry to get another hands the component a second
// React instance whose effects the renderer never runs. The test DOM cannot
// reach the network, so the outcome here is failure, which is the half worth
// pinning: that the widget reports the failure up instead of leaving the form
// waiting on a token that will never come.
//
// Two failure shapes reach onUnavailable. The script erroring is what the
// test DOM produces and what these tests exercise. The other — a request a proxy
// black-holes, firing neither `load` nor `error` — is why the widget also
// carries a load deadline; the unmount test below is what keeps that timer
// from outliving the component. What the callback then *does* is covered
// where a regression would actually hurt, in SignupPage.test.tsx and
// RegisterForm.test.tsx.

beforeEach(() => {
  vi.useFakeTimers()
  delete (window as { turnstile?: unknown }).turnstile
})
afterEach(() => vi.useRealTimers())

describe('TurnstileWidget when the challenge cannot run', () => {
  it('reports unavailable instead of leaving the form waiting on a token', async () => {
    const onUnavailable = vi.fn()
    render(<TurnstileWidget siteKey="k" onToken={vi.fn()} onUnavailable={onUnavailable} />)

    await act(async () => { vi.advanceTimersByTime(20_000) })
    expect(onUnavailable).toHaveBeenCalled()
  })

  // A caller that never passes one must not crash on the failure path.
  it('survives having no onUnavailable handler', async () => {
    expect(() => render(<TurnstileWidget siteKey="k" onToken={vi.fn()} />)).not.toThrow()
    await act(async () => { vi.advanceTimersByTime(20_000) })
  })

  it('stays quiet after unmount, so a diver who navigated away is told nothing', async () => {
    const onUnavailable = vi.fn()
    const { unmount } = render(
      <TurnstileWidget siteKey="k" onToken={vi.fn()} onUnavailable={onUnavailable} />,
    )
    unmount()

    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(onUnavailable).not.toHaveBeenCalled()
  })

  it('renders its mount point regardless', () => {
    const { container } = render(<TurnstileWidget siteKey="k" onToken={vi.fn()} />)
    expect(container.querySelector('.cf-turnstile')).not.toBeNull()
  })
})
