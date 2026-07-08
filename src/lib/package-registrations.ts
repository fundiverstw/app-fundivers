import { supabase } from './supabase'
import { siteConfig } from '../config/site'
import type { PackageRegistration, RegistrationStatus, KickbackStatus } from '../types/database'

// Admin data layer for package registrations + the kickback ledger. Divers
// register through the register-package edge function and read their own via
// list_my_package_registrations(); this module is the admin side, reading /
// writing the base package_registrations table (gated by its "admin manage" RLS
// policy). It's also the "who registered for packages" roster surfaced in Manage.

/** The contact + label fields an admin needs to see who registered. */
export interface RegistrationDiver {
  id: string
  name: string | null
  nickname: string | null
  email: string | null
  contact_id: string | null
}

export interface AdminRegistration extends PackageRegistration {
  diver: RegistrationDiver | null
  package_title: string | null
  tier_name: string | null
}

export async function fetchRegistrationsWithDivers(): Promise<AdminRegistration[]> {
  const { data: regs, error } = await supabase
    .from('package_registrations')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  const rows = (regs ?? []) as PackageRegistration[]

  const diverIds = [...new Set(rows.map(r => r.diver_id))]
  const packageIds = [...new Set(rows.map(r => r.package_id))]
  const tierIds = [...new Set(rows.map(r => r.tier_id).filter(Boolean) as string[])]

  // The three label lookups are independent — run them in one round-trip.
  const [diversRes, packagesRes, tiersRes] = await Promise.all([
    diverIds.length
      ? supabase.from('profiles').select('id, name, nickname, email, contact_id').in('id', diverIds)
      : Promise.resolve({ data: [], error: null }),
    packageIds.length
      ? supabase.from('packages').select('id, title').in('id', packageIds)
      : Promise.resolve({ data: [], error: null }),
    tierIds.length
      ? supabase.from('package_tiers').select('id, name').in('id', tierIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (diversRes.error) throw diversRes.error
  if (packagesRes.error) throw packagesRes.error
  if (tiersRes.error) throw tiersRes.error

  const byDiver = new Map<string, RegistrationDiver>()
  for (const p of diversRes.data ?? []) byDiver.set((p as RegistrationDiver).id, p as RegistrationDiver)
  const titleById = new Map<string, string>()
  for (const p of packagesRes.data ?? []) titleById.set((p as { id: string }).id, (p as { title: string }).title)
  const tierById = new Map<string, string>()
  for (const t of tiersRes.data ?? []) tierById.set((t as { id: string }).id, (t as { name: string }).name)

  return rows.map(r => ({
    ...r,
    diver: byDiver.get(r.diver_id) ?? null,
    package_title: titleById.get(r.package_id) ?? null,
    tier_name: r.tier_id ? tierById.get(r.tier_id) ?? null : null,
  }))
}

/** Count of live (still 'registered') registrations — the admin's badge. */
export async function countNewRegistrations(): Promise<number> {
  const { count, error } = await supabase
    .from('package_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'registered')
  if (error) throw error
  return count ?? 0
}

export interface KickbackByCurrency {
  currency: string
  /** Total kickback we expect across live (non-cancelled) registrations. */
  expected: number
  /** Portion of that already marked paid. */
  paid: number
}

/**
 * Roll the kickback ledger up by currency: how much we expect vs how much has
 * been paid. Cancelled registrations (and rows with no estimate) contribute
 * nothing. Ordered by currency so the display is stable.
 */
export function summarizeKickbacks(regs: AdminRegistration[]): KickbackByCurrency[] {
  const byCur = new Map<string, { expected: number; paid: number }>()
  for (const r of regs) {
    if (r.status === 'cancelled' || r.kickback_amount == null) continue
    const cur = r.estimated_currency || siteConfig.locale.currency
    const acc = byCur.get(cur) ?? { expected: 0, paid: 0 }
    acc.expected += r.kickback_amount
    if (r.kickback_status === 'paid') acc.paid += r.kickback_amount
    byCur.set(cur, acc)
  }
  return [...byCur.entries()]
    .map(([currency, v]) => ({ currency, ...v }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
}

/** Move a registration's kickback between expected and paid; stamp paid_at only
 *  when it lands on paid. */
export async function setKickbackStatus(id: string, status: KickbackStatus): Promise<void> {
  const { error } = await supabase
    .from('package_registrations')
    .update({ kickback_status: status, paid_at: status === 'paid' ? new Date().toISOString() : null })
    .eq('id', id)
  if (error) throw error
}

/** Move a registration through the pipeline (registered → completed, or cancel). */
export async function setRegistrationStatus(id: string, status: RegistrationStatus): Promise<void> {
  const { error } = await supabase.from('package_registrations').update({ status }).eq('id', id)
  if (error) throw error
}

export async function updateRegistrationNotes(id: string, admin_notes: string | null): Promise<void> {
  const { error } = await supabase.from('package_registrations').update({ admin_notes }).eq('id', id)
  if (error) throw error
}
