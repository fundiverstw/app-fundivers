import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
const getSession = vi.fn()
vi.mock('./supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    auth: { getSession: () => getSession() },
  },
}))

const fetchMock = vi.fn()

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ data: { ok: true }, error: null })
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'tok' } } })
  fetchMock.mockReset().mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetchMock)
  vi.unstubAllEnvs()
})

async function importFresh() {
  vi.resetModules()
  return await import('./event-cancellation')
}

describe('notifyEventCancelled', () => {
  it('invokes the email edge function and posts to the push worker when configured', async () => {
    vi.stubEnv('VITE_PUSH_WORKER_URL', 'https://push.example.com')
    const { notifyEventCancelled } = await importFresh()
    await notifyEventCancelled('evt1', 'dive')

    expect(invoke).toHaveBeenCalledWith('notify-event-cancellation', { body: { event_id: 'evt1', event_type: 'dive' } })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://push.example.com/admin-event-cancellation',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer tok' }),
        body: JSON.stringify({ event_id: 'evt1', event_type: 'dive' }),
      }),
    )
  })

  it('still sends the email but skips the push call when no worker URL is set', async () => {
    vi.stubEnv('VITE_PUSH_WORKER_URL', '')
    const { notifyEventCancelled } = await importFresh()
    await notifyEventCancelled('evt2', 'course')

    expect(invoke).toHaveBeenCalledWith('notify-event-cancellation', { body: { event_id: 'evt2', event_type: 'course' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not reject when a channel throws (best-effort)', async () => {
    vi.stubEnv('VITE_PUSH_WORKER_URL', 'https://push.example.com')
    fetchMock.mockRejectedValue(new Error('worker down'))
    invoke.mockRejectedValue(new Error('email down'))
    const { notifyEventCancelled } = await importFresh()
    await expect(notifyEventCancelled('evt3', 'dive')).resolves.toBeUndefined()
  })
})
