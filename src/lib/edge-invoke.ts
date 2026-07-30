import { supabase } from './supabase'

// Registration and other edge-function calls can be lost to a flaky connection
// mid-submit — the exact frustration behind the resume-draft work. supabase-js
// distinguishes two failure shapes:
//   - FunctionsFetchError / FunctionsRelayError — the request never got an HTTP
//     response (DNS/TCP/TLS failure, timeout, offline). Safe to retry: either
//     the server never saw it, or its response was lost.
//   - FunctionsHttpError — the server responded with a non-2xx status. That's a
//     deterministic outcome (validation, dedupe, auth). Retrying just repeats
//     it, so we DON'T. Notably create-registration returns HTTP 500 for its
//     duplicate-booking guard, so a blanket "retry 5xx" would be wrong.
export function isTransientInvokeError(error: unknown): boolean {
  const name = (error as { name?: string } | null | undefined)?.name
  return name === 'FunctionsFetchError' || name === 'FunctionsRelayError'
}

export interface InvokeResult<T> {
  data: T | null
  error: (Error & { context?: unknown }) | null
}

interface RetryOptions {
  retries?: number
  baseDelayMs?: number
  // Injectable for tests — real callers use the default setTimeout sleep.
  sleep?: (ms: number) => Promise<void>
}

/**
 * Invoke an edge function, retrying only transient (no-response) failures with
 * exponential backoff. Returns the last {data, error} either way — the caller
 * still handles a deterministic error normally. A successful call returns on the
 * first attempt with no delay.
 */
export async function invokeWithRetry<T>(
  name: string,
  options: { body: Record<string, unknown> },
  { retries = 2, baseDelayMs = 500, sleep }: RetryOptions = {},
): Promise<InvokeResult<T>> {
  const doSleep = sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  let last: InvokeResult<T> = { data: null, error: null }
  for (let attempt = 0; attempt <= retries; attempt++) {
    last = await supabase.functions.invoke<T>(name, options) as InvokeResult<T>
    if (!last.error || !isTransientInvokeError(last.error)) return last
    if (attempt < retries) await doSleep(baseDelayMs * 2 ** attempt)
  }
  return last
}

/**
 * The server's real error message out of a FunctionsHttpError.
 *
 * supabase-js wraps every non-2xx edge response as a FunctionsHttpError whose
 * `.message` is only "Edge Function returned a non-2xx status code"; the
 * function's own `{ error }` JSON is buried in `.context` (a Response). Without
 * digging it out an admin sees an opaque status error instead of "email already
 * registered" / "forbidden".
 */
export async function edgeErrorMessage(
  error: { message: string; context?: unknown },
): Promise<string> {
  const ctx = error.context
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const body = await (ctx as Response).json() as { error?: string }
      if (body?.error) return body.error
    } catch { /* body wasn't JSON — fall back to the generic message */ }
  }
  return error.message
}
