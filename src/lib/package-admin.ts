import { supabase } from './supabase'
import { siteConfig } from '../config/site'
import type { Package, PackageInsert, PackageStatus, PackageTier } from '../types/database'

// Admin data layer for packages + their price tiers. The hosting partner is a
// trusted_partners row (CRUD in trusted-partners.ts). Diver-facing reads go
// through the definer functions in packages.ts; this module is the admin CRUD
// against the base `packages` / `package_tiers` tables (gated by their "admin
// manage" RLS policies).

export interface TierDraft {
  id?: string
  name: string
  price: number
}

export async function fetchPackages(): Promise<Package[]> {
  const { data, error } = await supabase
    .from('packages')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Package[]
}

/** A package's tiers, cheapest first — for the admin edit form. */
export async function fetchPackageTiers(packageId: string): Promise<PackageTier[]> {
  const { data, error } = await supabase
    .from('package_tiers')
    .select('*')
    .eq('package_id', packageId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as PackageTier[]
}

/**
 * Stamp published_at the first time a package goes live so the board can order
 * by "newest published". Re-publishing keeps the original stamp.
 */
function withPublishStamp(values: PackageInsert, existing?: Package): PackageInsert {
  if (values.status === 'published' && !values.published_at && !existing?.published_at) {
    return { ...values, published_at: new Date().toISOString() }
  }
  return values
}

/**
 * Reconcile the package's tier rows against the form drafts: delete removed
 * tiers, update kept ones, insert new ones. sort_order follows draft order so
 * the "increasing price tiers" ordering is whatever the admin arranged.
 */
async function syncTiers(packageId: string, currency: string, tiers: TierDraft[]): Promise<void> {
  const { data: existingRows, error } = await supabase
    .from('package_tiers').select('id').eq('package_id', packageId)
  if (error) throw error
  const keepIds = new Set(tiers.map(t => t.id).filter(Boolean) as string[])
  const toDelete = (existingRows ?? []).map(r => (r as { id: string }).id).filter(id => !keepIds.has(id))
  if (toDelete.length) {
    const { error: dErr } = await supabase.from('package_tiers').delete().in('id', toDelete)
    if (dErr) throw dErr
  }
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i]
    const row = { package_id: packageId, name: t.name, price: t.price, currency, sort_order: i }
    if (t.id) {
      const { error: uErr } = await supabase.from('package_tiers').update(row).eq('id', t.id)
      if (uErr) throw uErr
    } else {
      const { error: iErr } = await supabase.from('package_tiers').insert(row)
      if (iErr) throw iErr
    }
  }
}

/** Insert / update a package plus its tiers (a package must end up with ≥1 tier;
 *  the form enforces that). */
export async function savePackage(values: PackageInsert, tiers: TierDraft[], existing?: Package): Promise<void> {
  const payload = withPublishStamp(values, existing)
  const currency = values.currency ?? siteConfig.locale.currency
  let packageId: string
  if (existing) {
    const { error } = await supabase.from('packages').update(payload).eq('id', existing.id)
    if (error) throw error
    packageId = existing.id
  } else {
    const { data, error } = await supabase.from('packages').insert(payload).select('id').single()
    if (error) throw error
    packageId = (data as { id: string }).id
  }
  await syncTiers(packageId, currency, tiers)
}

export async function setPackageStatus(pkg: Package, status: PackageStatus): Promise<void> {
  const patch = withPublishStamp({ ...pkg, status }, pkg)
  const { error } = await supabase
    .from('packages')
    .update({ status, published_at: patch.published_at ?? pkg.published_at })
    .eq('id', pkg.id)
  if (error) throw error
}

export async function deletePackage(id: string): Promise<void> {
  const { error } = await supabase.from('packages').delete().eq('id', id)
  if (error) throw error
}
