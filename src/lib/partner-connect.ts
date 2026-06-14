import { supabase } from './supabase'

export interface PartnerConnectRequest {
  destination: string
  note?: string
}

// Sends a Partner Connect (PX) request to the shop inbox via the
// partner-connect edge function. Throws with a user-facing message on
// failure so the form can surface it.
export async function sendPartnerConnectRequest(req: PartnerConnectRequest): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok: boolean }>('partner-connect', {
    body: { destination: req.destination, note: req.note ?? '' },
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
