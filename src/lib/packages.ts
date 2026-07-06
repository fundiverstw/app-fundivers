import { supabase } from './supabase'
import type { PackageBoardItem, MyPackageReferral } from '../types/database'

/**
 * Record that the signed-in diver is interested in a published package and
 * return their referral code (FD-XXXXXX). Runs inside the
 * express_package_interest SECURITY DEFINER RPC: it mints a referral on first
 * interest and is idempotent — tapping again returns the same code rather than
 * erroring on the one-live-referral-per-package index. The RPC returns only the
 * code, so the diver never reads their referral's kickback columns.
 */
export async function expressPackageInterest(packageId: string): Promise<string> {
  const { data, error } = await supabase.rpc('express_package_interest', { p_package_id: packageId })
  if (error) throw error
  if (!data) throw new Error('express_package_interest returned no code')
  return data as string
}

/**
 * The published Packages board, newest-published first. Reads the
 * list_package_board() definer function, which exposes only diver-safe columns
 * (no kickback rate) and joins in the partner shop we vouch for.
 */
export async function fetchPackageBoard(): Promise<PackageBoardItem[]> {
  const { data, error } = await supabase
    .rpc('list_package_board')
    .order('published_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PackageBoardItem[]
}

/** One published package by id (for the detail page / deep links), or null if
 *  it isn't on the board. Same diver-safe projection as fetchPackageBoard. */
export async function fetchPackageBoardItem(id: string): Promise<PackageBoardItem | null> {
  const { data, error } = await supabase
    .rpc('list_package_board')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as PackageBoardItem | null
}

/**
 * The signed-in diver's own package referrals (code + status + package/partner
 * labels), newest first. Reads list_my_package_referrals(), which is scoped to
 * auth.uid() and carries none of the kickback ledger.
 */
export async function fetchMyPackageReferrals(): Promise<MyPackageReferral[]> {
  const { data, error } = await supabase
    .rpc('list_my_package_referrals')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as MyPackageReferral[]
}
