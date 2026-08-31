import { supabase } from './supabase'
import type { PaymentMethod, PaymentMethodInsert } from '../types/database'

// Read + admin-write helpers for the shop's payment methods. Reference data:
// publicly readable so the register form can render the options, admin-written
// (see the payment_methods RLS). The rendering rules live in
// payment-method-format.ts, which the Deno edge functions share.

/** Every method, in the shop's chosen order — the admin list. */
export async function fetchPaymentMethods(): Promise<PaymentMethod[]> {
  const { data, error } = await supabase
    .from('payment_methods').select('*').order('sort_order').order('label')
  if (error) throw error
  return (Array.isArray(data) ? data : []) as PaymentMethod[]
}

/** Only what a diver may pick — the register forms. */
export async function fetchActivePaymentMethods(): Promise<PaymentMethod[]> {
  const { data, error } = await supabase
    .from('payment_methods').select('*').eq('active', true).order('sort_order').order('label')
  if (error) throw error
  return (Array.isArray(data) ? data : []) as PaymentMethod[]
}

/** Insert (no id) or update (id given). */
export async function savePaymentMethod(
  values: PaymentMethodInsert, id?: string,
): Promise<void> {
  const { error } = id
    ? await supabase.from('payment_methods').update(values).eq('id', id)
    : await supabase.from('payment_methods').insert(values)
  if (error) throw error
}

export async function deletePaymentMethod(id: string): Promise<void> {
  const { error } = await supabase.from('payment_methods').delete().eq('id', id)
  if (error) throw error
}

/**
 * The method a booking was made with. Falls back to null rather than the first
 * available method: a booking made under a since-deleted method must not
 * silently inherit another method's bank account.
 */
export function findPaymentMethod(
  methods: PaymentMethod[], key: string | null | undefined,
): PaymentMethod | null {
  if (!key) return null
  return methods.find(m => m.key === key) ?? null
}
