import { describe, it, expect } from 'vitest'
import { adminClient, anonClient } from './helpers'

// Migration 20260712010000 revokes anon/authenticated EXECUTE on two
// SECURITY DEFINER (RLS-bypassing) writer RPCs that were anon-callable in the
// baseline. They are meant to run only from a DB trigger (internal) or the
// service-role push worker. A random event UUID is safe to pass: with no
// matching waitlisted booking / event row, both no-op instead of writing.
const RANDOM_EVENT_ID = '00000000-0000-0000-0000-000000000000'

describe('anon-granted SECURITY DEFINER RPC lockdown', () => {
  it('offer_next_waitlist_spot is not callable by an unauthenticated client', async () => {
    const { error } = await anonClient().rpc('offer_next_waitlist_spot', {
      p_event_id: RANDOM_EVENT_ID,
    })
    expect(error).not.toBeNull()
  })

  it('refresh_event_display_title is not callable by an unauthenticated client', async () => {
    const { error } = await anonClient().rpc('refresh_event_display_title', {
      p_event_id: RANDOM_EVENT_ID,
    })
    expect(error).not.toBeNull()
  })

  it('both remain callable by the service role', async () => {
    const offer = await adminClient().rpc('offer_next_waitlist_spot', {
      p_event_id: RANDOM_EVENT_ID,
    })
    expect(offer.error).toBeNull()

    const refresh = await adminClient().rpc('refresh_event_display_title', {
      p_event_id: RANDOM_EVENT_ID,
    })
    expect(refresh.error).toBeNull()
  })
})
