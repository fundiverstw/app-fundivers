import { describe, it, expect } from 'vitest'
import { adminClient, anonClient } from './helpers'

// Migration 20261116100000. Production's default privileges handed anon
// EXECUTE on every function created after the baseline, so these reached the
// cloud database callable over PostgREST while local stacks showed them locked.
// Each call below is harmless if it ever got through: the cutoff matches no
// diver, the ids match no row.
const NO_ROW = '00000000-0000-0000-0000-000000000000'

const SERVICE_ONLY: Array<[string, Record<string, unknown>]> = [
  ['purge_stale_pii', { older_than_months: 1200 }],
  ['record_signup_attempt', { p_ip_hash: '\\x00' }],
  ['log_orphan_auth_user', { p_user_id: NO_ROW, p_email: 'nobody@example.com', p_reason: 'test' }],
]

const SIGNED_IN_ONLY: Array<[string, Record<string, unknown>]> = [
  ['admin_delete_user', { p_user_id: NO_ROW }],
  ['apply_credit_to_booking', { p_booking_id: NO_ROW, p_amount: 1 }],
  ['accept_waitlist_offer', { p_offer_id: NO_ROW }],
  [
    'create_course_continuation',
    { p_source_booking: NO_ROW, p_event_id: NO_ROW, p_days: [], p_source_days: [], p_charge_label: 'x' },
  ],
]

describe('privileged SECURITY DEFINER functions refuse anon', () => {
  it.each([...SERVICE_ONLY, ...SIGNED_IN_ONLY, ['normalize_profile_values', {}] as [string, Record<string, unknown>]])(
    '%s is not executable by an unauthenticated client',
    async (fn, args) => {
      const { error } = await anonClient().rpc(fn as never, args as never)
      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/permission denied/i)
    },
  )

  it.each(SERVICE_ONLY)('%s stays executable by the service role', async (fn, args) => {
    const { error } = await adminClient().rpc(fn as never, args as never)
    expect(error).toBeNull()
  })
})
