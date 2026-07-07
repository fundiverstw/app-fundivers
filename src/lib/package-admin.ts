import { supabase } from './supabase'
import type { Package, PackageInsert, PackageStatus } from '../types/database'

// Admin data layer for the packages themselves. The hosting partner is a
// trusted_partners row — its CRUD lives in trusted-partners.ts (the single
// partner editor). The diver-facing reads go through the definer functions in
// packages.ts; this module is the admin CRUD against the base `packages` table
// (gated by its "packages: admin manage" RLS policy).

export async function fetchPackages(): Promise<Package[]> {
  const { data, error } = await supabase
    .from('packages')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Package[]
}

/**
 * Stamp published_at the first time a package goes live so the board can order
 * by "newest published". Re-publishing (draft → published → draft → published)
 * keeps the original stamp; we only set it when it's still null.
 */
function withPublishStamp(values: PackageInsert, existing?: Package): PackageInsert {
  if (values.status === 'published' && !values.published_at && !existing?.published_at) {
    return { ...values, published_at: new Date().toISOString() }
  }
  return values
}

export async function savePackage(values: PackageInsert, existing?: Package): Promise<void> {
  const payload = withPublishStamp(values, existing)
  if (existing) {
    const { error } = await supabase.from('packages').update(payload).eq('id', existing.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('packages').insert(payload)
    if (error) throw error
  }
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
