import { describe, it, expect } from 'vitest'
import { adminClient, anonClient } from './helpers'

// public.wix_sync_all() (migration 20260711000000) is the push-based full sync:
// it re-emits every catalog/event row to the Wix webhook. Two things are safe to
// pin here without POSTing anywhere:
//   1. it refuses to run unless the wix_sync_token vault secret is set, so it
//      never fires against production from a token-less local/CI database;
//   2. it is restricted to the service role — an unauthenticated caller can't
//      invoke it (it makes outbound POSTs, so it must not be diver-reachable).
//
// The firing path is deliberately NOT exercised: this repo hardcodes the live
// fundiverstw.com webhook URL, so calling wix_sync_all() with a token set would
// POST to production Wix.

describe('wix_sync_all() full sync', () => {
  it('refuses to run when the wix_sync_token vault secret is absent', async () => {
    const { error } = await adminClient().rpc('wix_sync_all' as never, {} as never)
    expect(error).not.toBeNull()
    expect(error?.message ?? '').toMatch(/wix_sync_token/)
  })

  it('is not callable by an unauthenticated client', async () => {
    const { error } = await anonClient().rpc('wix_sync_all' as never, {} as never)
    expect(error).not.toBeNull()
  })
})
