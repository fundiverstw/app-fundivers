/**
 * How a diver reaches the shop: the details, and the buttons.
 *
 * Both are shop-authored (`shop_contact`, `contact_channels`) rather than
 * config literals, so an admin can change the email, add a Telegram link or
 * retire a dead WhatsApp number without a developer and a redeploy. This module
 * is what reads them and what decides where a button points; the styling and
 * the glyphs live with the component, and the vocabulary in types/database.ts.
 */
import { supabase } from './supabase'
import { t } from '../i18n'
import type { ContactChannel, ContactChannelKind, ShopContactRow } from '../types/database'

/** The details, with the shape every consumer actually wants. */
export interface ShopContactDetails {
  email: string
  phone: string
  address: string
  mapsUrl: string | null
}

export const NO_SHOP_CONTACT: ShopContactDetails = {
  email: '', phone: '', address: '', mapsUrl: null,
}

function detailsOf(row: ShopContactRow): ShopContactDetails {
  return {
    email: row.email,
    phone: row.phone,
    address: row.address,
    mapsUrl: row.maps_url,
  }
}

/**
 * Where a channel's button goes.
 *
 * `phone` and `sms` store a bare number — an admin types a phone number into a
 * box labelled "phone number", not a URI scheme — so the scheme is added here,
 * with the spacing and punctuation stripped that a dialler would choke on.
 * Everything else already holds the link the shop pasted.
 */
export function channelHref(channel: { kind: ContactChannelKind; url: string }): string {
  if (channel.kind === 'phone') return `tel:${dialable(channel.url)}`
  if (channel.kind === 'sms') return `sms:${dialable(channel.url)}`
  return channel.url
}

function dialable(raw: string): string {
  const kept = raw.replace(/[^0-9+]/g, '')
  // A plus is only meaningful as the country prefix; one that turned up in the
  // middle of a pasted number is punctuation, not a plus.
  return kept.startsWith('+') ? `+${kept.slice(1).replace(/\+/g, '')}` : kept.replace(/\+/g, '')
}

/**
 * What a channel's button says.
 *
 * The shop's own wording when it wrote some — that text is user-generated and
 * is never translated — and the deployment's wording for that service when it
 * did not, so adding a Telegram link is one field rather than one field and a
 * sentence in three languages.
 */
export function channelLabel(channel: { kind: ContactChannelKind; label: string | null }): string {
  return channel.label?.trim() || t.contact.channelDefaults[channel.kind]
}

/** The details, or the empty ones — a shop mid-setup has published nothing,
 *  and every surface that shows contact details already handles their absence. */
export async function fetchShopContact(): Promise<ShopContactDetails> {
  const { data, error } = await supabase.from('shop_contact').select('*').maybeSingle()
  if (error) {
    console.error('Failed to load the shop contact details:', error)
    return NO_SHOP_CONTACT
  }
  return data ? detailsOf(data) : NO_SHOP_CONTACT
}

/** The buttons a diver sees: active only, in the shop's order. */
export async function fetchContactChannels(): Promise<ContactChannel[]> {
  const { data, error } = await supabase
    .from('contact_channels')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true })
  if (error) {
    console.error('Failed to load the contact channels:', error)
    return []
  }
  return data ?? []
}

/** Every channel, retired ones included — the admin list. */
export async function fetchAllContactChannels(): Promise<ContactChannel[]> {
  const { data, error } = await supabase
    .from('contact_channels')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data ?? []
}

// ── Admin writes ─────────────────────────────────────────────────────────────
// RLS lets only an admin through; these throw so the page can say what the
// database said rather than failing silently.

export interface ShopContactInput {
  email: string
  phone: string
  address: string
  maps_url: string | null
}

/** Update the one row. There is no insert: the row is seeded by the migration
 *  and the singleton check makes a second one impossible. */
export async function saveShopContact(values: ShopContactInput): Promise<void> {
  const { error } = await supabase
    .from('shop_contact')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('singleton', true)
  if (error) throw error
}

export interface ContactChannelInput {
  kind: ContactChannelKind
  label: string | null
  url: string
  sort_order: number
  active: boolean
}

export async function saveContactChannel(
  values: ContactChannelInput, id?: string,
): Promise<void> {
  const { error } = id
    ? await supabase.from('contact_channels').update(values).eq('id', id)
    : await supabase.from('contact_channels').insert(values)
  if (error) throw error
}

export async function deleteContactChannel(id: string): Promise<void> {
  const { error } = await supabase.from('contact_channels').delete().eq('id', id)
  if (error) throw error
}
