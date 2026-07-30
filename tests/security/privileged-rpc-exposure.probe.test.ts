import { describe, it, expect } from 'vitest'
import { rawFetch, restUrl } from './probe'

// Wire-level probe: no privileged RPC answers an unauthenticated caller.
//
// The exposure this pins is not a policy mistake, it is a default. Supabase
// grants EXECUTE on newly created functions to anon and authenticated, so a
// SECURITY DEFINER function added by a future migration is reachable at
// /rest/v1/rpc/<name> the moment it exists, by anyone holding the anon key --
// which ships in the public SPA bundle and is not a secret. Nothing in the
// schema announces that; the function simply works for the internet.
//
// This deployment's baseline already revoked the dangerous ones, so the probe
// pins a posture that holds rather than fixing a hole. It is worth having
// anyway: the fundive repo, squashed from a nearby state, shipped
// purge_stale_pii anon-callable -- SECURITY DEFINER (so RLS does not apply)
// with no internal auth gate, one POST away from nulling id_number,
// medical_notes, emergency contacts and cert-card paths across every diver
// row. The difference between the two repos was a single grant nobody was
// asserting on. This is that assertion.
//
// Raw fetch rather than supabase-js on purpose: this suite sends the bytes an
// attacker sends. rawFetch defaults to the anon apikey, which is exactly the
// unauthenticated caller we care about.

// Arguments are chosen so that a REGRESSION here is still non-destructive: if
// a revoke is ever lost, the probe fails on the status code without the call
// having done any damage. purge_stale_pii gets 9999 months (a cutoff far in
// the past matches no rows) rather than the 0 that would scrub everyone.
const PRIVILEGED_RPCS: ReadonlyArray<{ name: string; args: Record<string, unknown> }> = [
  { name: 'purge_stale_pii',        args: { older_than_months: 9999 } },
  { name: 'record_signup_attempt',  args: { p_ip_hash: '\\x00' } },
  { name: 'log_orphan_auth_user',   args: { p_user_id: '00000000-0000-0000-0000-000000000000', p_email: 'probe@example.invalid', p_reason: 'probe' } },
  { name: 'admin_delete_user',      args: { p_user_id: '00000000-0000-0000-0000-000000000000' } },
  { name: 'record_group_payment',   args: { p_lead: '00000000-0000-0000-0000-000000000000', p_amount: 1, p_group_id: '00000000-0000-0000-0000-000000000000' } },
  { name: 'apply_credit_to_booking', args: { p_booking_id: '00000000-0000-0000-0000-000000000000', p_amount: 1 } },
  { name: 'accept_waitlist_offer',  args: { p_offer_id: '00000000-0000-0000-0000-000000000000' } },
  { name: 'offer_next_waitlist_spot', args: { p_event_id: '00000000-0000-0000-0000-000000000000' } },
  { name: 'refresh_event_display_title', args: { p_event_id: '00000000-0000-0000-0000-000000000000' } },
]

describe('privileged RPCs are not reachable by an unauthenticated caller', () => {
  for (const rpc of PRIVILEGED_RPCS) {
    it(`${rpc.name} refuses the anon key`, async () => {
      const r = await rawFetch(restUrl(`/rpc/${rpc.name}`), {
        method: 'POST',
        body: rpc.args,
      })
      // PostgREST answers a missing EXECUTE grant with 401 + SQLSTATE 42501.
      // Asserting the code (not just "not 200") keeps the probe honest: a
      // function that 400s on bad arguments would otherwise look like a pass
      // while still being callable.
      expect(r.status, `${rpc.name} answered ${r.status}: ${r.text}`).toBe(401)
      expect(r.text).toMatch(/permission denied/i)
    })
  }

  // Guards the probe itself. If the anon key stopped working, or the RPC path
  // were wrong, every assertion above would pass for the wrong reason -- a
  // silent no-op suite. A function anon IS meant to reach proves the wire path
  // is live and the key is accepted.
  it('the probe reaches PostgREST at all (control)', async () => {
    const r = await rawFetch(restUrl('/rpc/list_trusted_partners'), {
      method: 'POST',
      body: {},
    })
    expect(r.status, `control call answered ${r.status}: ${r.text}`).toBe(200)
  })
})
