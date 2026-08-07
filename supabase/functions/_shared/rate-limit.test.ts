import { describe, it, expect, vi } from 'vitest'
import { takeActionSlot, rateLimitedBody, RATE_LIMITS, type RpcClient } from './rate-limit'

function client(result: { data: unknown; error: { message: string } | null }): RpcClient {
  return { rpc: vi.fn().mockResolvedValue(result) }
}

describe('takeActionSlot', () => {
  it('passes the action, limit and window from the table to the RPC', async () => {
    const c = client({ data: 0, error: null })
    await takeActionSlot(c, 'u1', 'contact_partner')
    expect(c.rpc).toHaveBeenCalledWith('take_action_slot', {
      p_user_id: 'u1',
      p_action:  'contact_partner',
      p_limit:   RATE_LIMITS.contact_partner.limit,
      p_window:  RATE_LIMITS.contact_partner.window,
    })
  })

  it('allows when the RPC returns 0', async () => {
    const res = await takeActionSlot(client({ data: 0, error: null }), 'u1', 'register_package')
    expect(res).toEqual({ allowed: true, retryAfterSeconds: 0 })
  })

  it('refuses and reports the wait when the RPC returns seconds', async () => {
    const res = await takeActionSlot(client({ data: 900, error: null }), 'u1', 'register_package')
    expect(res).toEqual({ allowed: false, retryAfterSeconds: 900 })
  })

  it('coerces a numeric string, since PostgREST may hand back text', async () => {
    const res = await takeActionSlot(client({ data: '450', error: null }), 'u1', 'partner_connect')
    expect(res).toEqual({ allowed: false, retryAfterSeconds: 450 })
  })

  // A limiter that cannot reach its ledger must not become an outage of its
  // own: these endpoints are ordinary shop functionality.
  it('fails open when the RPC errors, and says so in the log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await takeActionSlot(client({ data: null, error: { message: 'boom' } }), 'u1', 'group_summary')
    expect(res).toEqual({ allowed: true, retryAfterSeconds: 0 })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('treats a null result as allowed rather than crashing', async () => {
    const res = await takeActionSlot(client({ data: null, error: null }), 'u1', 'group_summary')
    expect(res.allowed).toBe(true)
  })
})

describe('rate limits table', () => {
  it('every action has a positive limit and a window', () => {
    for (const [action, cfg] of Object.entries(RATE_LIMITS)) {
      expect(cfg.limit, action).toBeGreaterThan(0)
      expect(cfg.window, action).toMatch(/hour|minute|day/)
    }
  })
})

describe('rateLimitedBody', () => {
  it('rounds the wait up to whole hours and pluralises', () => {
    expect(rateLimitedBody('contact_partner', 3600).error).toContain('1 hour')
    expect(rateLimitedBody('contact_partner', 3601).error).toContain('2 hours')
  })

  it('carries the machine-readable fields a client can act on', () => {
    expect(rateLimitedBody('group_summary', 120)).toMatchObject({
      action: 'group_summary',
      retry_after_seconds: 120,
    })
  })
})
