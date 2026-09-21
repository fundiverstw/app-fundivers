import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { act, createRef } from 'react'

// tests/setup.unit.ts swaps this widget out globally for a stub; this file
// wants the real one.
vi.unmock('./TurnstileWidget')

import { TurnstileWidget, type TurnstileHandle } from './TurnstileWidget'

// The regression these tests exist for: a token solved on step 2 of the
// register form was still being posted from step 4, minutes later. Cloudflare
// gives a token 300 seconds and one verification, so two new divers were
// rejected as robots for filling the form in at a human pace. The widget's job
// is now to hand out a token minted on demand — these pin that it does.
//
// The sibling file covers the case where the challenge cannot run at all. It
// gets its own file because the script-load promise is memoized at module
// scope: one outcome per file, and the outcome there is failure. Here the
// script is pre-planted so the real load path resolves.

interface FakeTurnstile {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  remove: (id: string) => void
  reset: (id?: string) => void
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** Callbacks handed to us by the widget on render, so a test can act as Cloudflare. */
let solve: (token: string) => void
let expire: () => void
let resets: number
let tokenSeq: number

beforeEach(() => {
  resets = 0
  tokenSeq = 0
  // Planted so the widget's loadScript() takes its "already on the page"
  // branch and resolves. Typed text/plain so happy-dom — which refuses to
  // fetch scripts and logs a DOMException when asked — leaves it alone; the
  // widget matches on the src alone.
  const script = document.createElement('script')
  script.type = 'text/plain'
  script.src = SCRIPT_URL
  document.head.appendChild(script)
  const fake: FakeTurnstile = {
    render: (_el, opts) => {
      solve  = opts.callback as (token: string) => void
      expire = opts['expired-callback'] as () => void
      // First solve is automatic, exactly as the invisible challenge behaves.
      solve(`token-${++tokenSeq}`)
      return 'widget-1'
    },
    remove: () => {},
    // A reset re-runs the challenge; the invisible variety answers straight
    // away with a new token.
    reset: () => { resets++; solve(`token-${++tokenSeq}`) },
  }
  ;(window as unknown as { turnstile: FakeTurnstile }).turnstile = fake
})

afterEach(() => {
  delete (window as { turnstile?: unknown }).turnstile
  document.head.querySelectorAll('script').forEach(s => s.remove())
  vi.useRealTimers()
})

async function mount() {
  const ref = createRef<TurnstileHandle>()
  const onToken = vi.fn()
  await act(async () => { render(<TurnstileWidget ref={ref} siteKey="k" onToken={onToken} />) })
  return { ref, onToken }
}

describe('TurnstileWidget.freshToken', () => {
  it('hands back the token it holds while it is younger than the caller allows', async () => {
    const { ref } = await mount()
    await expect(ref.current!.freshToken(60_000)).resolves.toBe('token-1')
    expect(resets).toBe(0)
  })

  it('re-runs the challenge when the token in hand has aged out', async () => {
    vi.useFakeTimers()
    const { ref, onToken } = await mount()
    vi.setSystemTime(Date.now() + 301_000)

    const fresh = await ref.current!.freshToken(120_000)
    expect(fresh).toBe('token-2')
    expect(resets).toBe(1)
    // The form's own state follows the new token, so a later submit and the
    // Next button agree with what Cloudflare last minted.
    expect(onToken).toHaveBeenLastCalledWith('token-2')
  })

  it('re-runs the challenge unconditionally when no max age is given', async () => {
    const { ref } = await mount()
    await expect(ref.current!.freshToken()).resolves.toBe('token-2')
    expect(resets).toBe(1)
  })

  it('re-challenges after an expiry wiped the token, rather than answering null', async () => {
    const { ref, onToken } = await mount()
    await act(async () => { expire() })
    expect(onToken).toHaveBeenLastCalledWith(null)

    await expect(ref.current!.freshToken(60_000)).resolves.toBe('token-2')
  })

  it('resolves null when the re-challenge needs a human, so the caller can show it', async () => {
    vi.useFakeTimers()
    const { ref } = await mount()
    // An interactive challenge: the reset puts something on screen and no
    // token arrives until it is solved.
    ;(window as unknown as { turnstile: FakeTurnstile }).turnstile.reset = () => { resets++ }

    const pending = ref.current!.freshToken()
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000) })
    await expect(pending).resolves.toBeNull()
    expect(resets).toBe(1)
  })

  it('resolves null once unmounted, so a form cannot wait on a widget that is gone', async () => {
    const ref = createRef<TurnstileHandle>()
    let unmount!: () => void
    await act(async () => {
      unmount = render(<TurnstileWidget ref={ref} siteKey="k" onToken={vi.fn()} />).unmount
    })
    const handle = ref.current!
    unmount()

    await expect(handle.freshToken(60_000)).resolves.toBeNull()
  })
})
