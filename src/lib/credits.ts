import { supabase } from './supabase'
import type { Credit, CreditInsert } from '../types/database'

/**
 * "Credits" are money the business owes a diver — typically issued when
 * an event is cancelled (weather, low signups). They sit at status='open'
 * until an admin settles them, either by paying the diver back externally
 * or by manually recording a payment when the diver applies the credit
 * to a new booking. We intentionally do NOT auto-create a paid payment
 * row on settle — the corresponding payment is recorded as a separate
 * action so the two-sided audit trail stays explicit.
 */

export async function fetchCreditsForUser(userId: string): Promise<Credit[]> {
  const { data, error } = await supabase
    .from('credits')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Credit[]
}

export function openCreditBalance(credits: Credit[]): number {
  return credits.filter(c => c.status === 'open').reduce((s, c) => s + Number(c.amount), 0)
}

export async function createCredit(input: {
  user_id: string
  amount: number
  reason: string
  booking_id?: string | null
  currency?: string
  created_by: string
}): Promise<Credit> {
  const row: CreditInsert = {
    user_id:    input.user_id,
    booking_id: input.booking_id ?? null,
    amount:     input.amount,
    currency:   input.currency ?? 'TWD',
    reason:     input.reason,
    created_by: input.created_by,
    status:     'open',
  }
  const { data, error } = await supabase
    .from('credits')
    .insert(row)
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('credit insert returned no row')
  return data as Credit
}

export async function settleCredit(args: {
  creditId: string
  note: string
}): Promise<Credit> {
  const { data, error } = await supabase
    .from('credits')
    .update({
      status:       'settled',
      settled_at:   new Date().toISOString(),
      settled_note: args.note,
    })
    .eq('id', args.creditId)
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('credit update returned no row')
  return data as Credit
}

export async function reopenCredit(creditId: string): Promise<Credit> {
  const { data, error } = await supabase
    .from('credits')
    .update({ status: 'open', settled_at: null, settled_note: null })
    .eq('id', creditId)
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('credit update returned no row')
  return data as Credit
}
