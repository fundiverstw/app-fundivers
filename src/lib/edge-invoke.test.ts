import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isTransientInvokeError, invokeWithRetry } from './edge-invoke'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./supabase', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}))

const noSleep = () => Promise.resolve()

function fetchError() {
  return Object.assign(new Error('Failed to send a request to the Edge Function'), { name: 'FunctionsFetchError' })
}
function httpError() {
  return Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    name: 'FunctionsHttpError',
    context: new Response('{"error":"nope"}', { status: 500 }),
  })
}

beforeEach(() => { invoke.mockReset() })

describe('isTransientInvokeError', () => {
  it('flags fetch/relay (no-response) errors as transient', () => {
    expect(isTransientInvokeError(fetchError())).toBe(true)
    expect(isTransientInvokeError(Object.assign(new Error(), { name: 'FunctionsRelayError' }))).toBe(true)
  })
  it('does not flag an HTTP (server-responded) error', () => {
    expect(isTransientInvokeError(httpError())).toBe(false)
    expect(isTransientInvokeError(null)).toBe(false)
  })
})

describe('invokeWithRetry', () => {
  it('returns immediately on success (no retries)', async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true }, error: null })
    const res = await invokeWithRetry('fn', { body: {} }, { sleep: noSleep })
    expect(res.data).toEqual({ ok: true })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('retries a transient failure then succeeds', async () => {
    invoke
      .mockResolvedValueOnce({ data: null, error: fetchError() })
      .mockResolvedValueOnce({ data: { ok: true }, error: null })
    const res = await invokeWithRetry('fn', { body: {} }, { sleep: noSleep })
    expect(res.data).toEqual({ ok: true })
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry a deterministic HTTP error (e.g. the dedupe 500)', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError() })
    const res = await invokeWithRetry('fn', { body: {} }, { sleep: noSleep })
    expect(res.error?.name).toBe('FunctionsHttpError')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('gives up after the retry budget on persistent transient failure', async () => {
    invoke.mockResolvedValue({ data: null, error: fetchError() })
    const res = await invokeWithRetry('fn', { body: {} }, { retries: 2, sleep: noSleep })
    expect(res.error?.name).toBe('FunctionsFetchError')
    expect(invoke).toHaveBeenCalledTimes(3) // initial + 2 retries
  })
})
