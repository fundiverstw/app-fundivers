import { supabase } from './supabase'
import type { PackageBoardItem, PackageTierItem, MyPackageRegistration } from '../types/database'

export interface RegisterForPackageInput {
  packageId: string
  tierId: string
  preferredStart: string
  preferredEnd: string
  addonIds: string[]
  roomId: string | null
  notes: string
}

export interface RegisterForPackageResult {
  registration_id: string
  estimated_cost: number | null
  estimated_currency: string | null
  already_registered?: boolean
  /** Whether the partner + diver recommendation emails actually went out. */
  emailed?: boolean
}

/**
 * Register the signed-in diver for a partner-shop package. Runs through the
 * register-package edge function, which recomputes the estimate authoritatively,
 * snapshots the kickback rate, inserts the registration, and emails the partner
 * shop + the diver. Idempotent against the one-live index: tapping again returns
 * the diver's existing registration rather than erroring.
 */
export async function registerForPackage(input: RegisterForPackageInput): Promise<RegisterForPackageResult> {
  const { data, error } = await supabase.functions.invoke('register-package', {
    body: {
      package_id: input.packageId,
      tier_id: input.tierId,
      preferred_start: input.preferredStart,
      preferred_end: input.preferredEnd,
      addon_ids: input.addonIds,
      room_id: input.roomId,
      notes: input.notes,
    },
  })
  if (error) {
    // supabase-js wraps a non-2xx as FunctionsHttpError; the human-readable
    // reason lives in .context (the Response). Surface it so the diver sees
    // "tier not found" etc. rather than the generic transport message.
    const ctx = (error as { context?: unknown }).context
    if (ctx && typeof (ctx as Response).json === 'function') {
      try {
        const body = await (ctx as Response).json() as { error?: string }
        if (body?.error) throw new Error(body.error)
      } catch (e) {
        if (e instanceof Error) throw e
      }
    }
    throw new Error(error.message)
  }
  return data as RegisterForPackageResult
}

/**
 * The published Packages board, newest-published first. Reads the
 * list_package_board() definer function, which exposes only diver-safe columns
 * (no kickback rate), the catalog id arrays, a "from" price and the vouched
 * partner shop.
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

/** The price tiers of a published package, cheapest first. Reads the
 *  list_package_tiers() definer function (diver-safe). */
export async function fetchPackageTiers(packageId: string): Promise<PackageTierItem[]> {
  const { data, error } = await supabase.rpc('list_package_tiers', { p_package_id: packageId })
  if (error) throw error
  return (data ?? []) as PackageTierItem[]
}

/** Cancel the diver's own registration (frees a retry). Runs the
 *  cancel_my_package_registration() definer function, scoped to auth.uid(). */
export async function cancelMyPackageRegistration(id: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_my_package_registration', { p_id: id })
  if (error) throw error
}

/**
 * The signed-in diver's own package registrations (labels + estimate + status),
 * newest first. Reads list_my_package_registrations(), scoped to auth.uid() and
 * carrying none of the kickback ledger.
 */
export async function fetchMyPackageRegistrations(): Promise<MyPackageRegistration[]> {
  const { data, error } = await supabase
    .rpc('list_my_package_registrations')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as MyPackageRegistration[]
}
