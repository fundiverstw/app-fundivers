import { supabase } from './supabase'
import type { Notification } from '../types/database'

// Single read source of truth for the inbox + bell badge. Pages and the
// header bell both call these — when state changes (mark-as-read), they
// dispatch `notifications-changed` so the bell refetches without coupling
// to a global state library.

const CHANGE_EVENT = 'notifications-changed'

export function notifyChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }
}

export function onNotificationsChanged(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CHANGE_EVENT, handler)
  return () => window.removeEventListener(CHANGE_EVENT, handler)
}

export async function fetchNotifications(): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return (data ?? []) as Notification[]
}

export async function fetchUnreadCount(): Promise<number> {
  // head:true tells PostgREST to skip the row payload; count comes back
  // in the Content-Range header. Same wire as a plain HEAD request, just
  // with the .from() typing.
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .is('read_at', null)
  if (error) throw error
  return count ?? 0
}

export async function markRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null)
  if (error) throw error
  notifyChanged()
}

export async function markAllRead(): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
  if (error) throw error
  notifyChanged()
}
