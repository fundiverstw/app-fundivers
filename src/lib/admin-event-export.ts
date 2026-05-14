import { supabase } from './supabase'

// Wrapper around the export-event-divers edge function. Admins call this
// from AdminEventDetailPage; the function builds a PDF manifest and emails
// it to the company address (BCCing the calling admin).

export async function requestEventDiverExport(
  eventType: 'dive' | 'course',
  eventId: string,
): Promise<{ ok: boolean; diver_count: number }> {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; diver_count: number }>(
    'export-event-divers',
    { body: { event_type: eventType, event_id: eventId } },
  )
  if (error) {
    // supabase-js wraps non-2xx as FunctionsHttpError; the response body
    // lives in .context. Pull the server's error string out so callers
    // can show something useful instead of a generic network error.
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
  return data!
}
