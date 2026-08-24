import { supabase } from './supabase'
import type { CancellationPolicy, Database } from '../types/database'

// Admin CRUD for the shop's cancellation policies. The table pre-existed (events
// point at one via events.cancel_policy); this adds the read + write helpers the
// new Manage → Cancellation policies page uses. Reference data: publicly
// readable, admin-written (see the cancellation_policies RLS).

export type CancellationPolicyInsert =
  Database['public']['Tables']['cancellation_policies']['Insert']

/** Every policy, newest-usable ordering by title (admin list + event picker). */
export async function fetchCancellationPolicies(): Promise<CancellationPolicy[]> {
  const { data, error } = await supabase
    .from('cancellation_policies').select('*').order('title')
  if (error) throw error
  return (Array.isArray(data) ? data : []) as CancellationPolicy[]
}

/** Insert (no id) or update (id given). */
export async function saveCancellationPolicy(
  values: CancellationPolicyInsert, id?: string,
): Promise<void> {
  const { error } = id
    ? await supabase.from('cancellation_policies').update(values).eq('id', id)
    : await supabase.from('cancellation_policies').insert(values)
  if (error) throw error
}

export async function deleteCancellationPolicy(id: string): Promise<void> {
  const { error } = await supabase.from('cancellation_policies').delete().eq('id', id)
  if (error) throw error
}

/**
 * Does attaching this policy to this event actually hold money back?
 *
 * `deposit_refundable = false` alone is a promise, not an outcome. What
 * `bookings_credit_on_cancel` withholds is `details.deposit`, which
 * create-registration copies from the chosen tier's `prices.deposit_amount` —
 * null on a tier that takes no deposit, and `?? 0` from there. So a
 * keep-the-deposit policy on a no-deposit tier keeps nothing, and telling an
 * admin otherwise is how they come to believe a cancellation was handled when
 * it refunded in full.
 */
export function keepsDepositOnCancel(
  policy: Pick<CancellationPolicy, 'deposit_refundable'> | null | undefined,
  depositAmount: number | null | undefined,
): boolean {
  return policy?.deposit_refundable === false && (depositAmount ?? 0) > 0
}
