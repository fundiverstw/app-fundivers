import { supabase } from './supabase'
import type { TrustedPartner, TrustedPartnerRow, TrustedPartnerInsert } from '../types/database'

// Data layer for the unified trusted_partners table (20260707220000 — one table
// for "dive shops abroad we vouch for", also the host of Packages). Admin-only
// direct access; divers read the public columns via the list_trusted_partners()
// RPC — the contact email never reaches the client. Contacting a partner goes
// through the contact-trusted-partner edge function, which resolves the email
// server-side.

// Diver-facing: the active, reachable partners — name/region/blurb/website only
// (no email/kickback). Every active partner that has a contact email appears.
export async function fetchTrustedPartners(): Promise<TrustedPartner[]> {
  const { data, error } = await supabase.rpc('list_trusted_partners')
  if (error) throw error
  return (data ?? []) as TrustedPartner[]
}

// Diver-facing: send a message to one partner. The edge function emails the
// partner from the shop address, cc's the shop, and replies-to the diver.
// Surfaces the edge function's error body so the compose form can show it.
export async function contactTrustedPartner(args: { partnerId: string; message: string }): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok: boolean }>('contact-trusted-partner', {
    body: { partner_id: args.partnerId, message: args.message },
  })
  if (error) {
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
}

// Admin-only: full rows (incl. email) for the management screen.
export async function fetchAllTrustedPartners(): Promise<TrustedPartnerRow[]> {
  const { data, error } = await supabase
    .from('trusted_partners')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as TrustedPartnerRow[]
}

export async function saveTrustedPartner(values: TrustedPartnerInsert, id?: string): Promise<void> {
  if (id) {
    const { error } = await supabase.from('trusted_partners').update(values).eq('id', id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('trusted_partners').insert(values)
    if (error) throw error
  }
}

export async function deleteTrustedPartner(id: string): Promise<void> {
  const { error } = await supabase.from('trusted_partners').delete().eq('id', id)
  if (error) throw error
}
