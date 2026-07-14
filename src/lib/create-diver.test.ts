import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDiverAccount } from './create-diver'
import { mockQueryBuilder } from '../../tests/test-utils'
import { t } from '../i18n'

const { invoke, from } = vi.hoisted(() => ({ invoke: vi.fn(), from: vi.fn() }))
vi.mock('./supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => from(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}))

const ad = t.admin.addDiver
const profileRow = { id: 'd1', name: 'Jane Diver' }

beforeEach(() => {
  invoke.mockReset()
  from.mockReset()
})

describe('createDiverAccount', () => {
  it('mints the account then returns the refetched profile', async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, user_id: 'd1', email_sent: true }, error: null })
    from.mockImplementation(() => mockQueryBuilder({ data: profileRow }))

    const result = await createDiverAccount({ email: ' Jane@Example.com ', name: ' Jane Diver ', nickname: ' JD ' })

    expect(result).toEqual({ profile: profileRow, emailSent: true })
    const [fn, opts] = invoke.mock.calls[0]
    expect(fn).toBe('admin-create-diver')
    // Email is normalized, name trimmed, blank nickname collapses to undefined.
    expect((opts as { body: Record<string, unknown> }).body).toMatchObject({
      email: 'jane@example.com',
      name: 'Jane Diver',
      nickname: 'JD',
    })
  })

  it('threads eventTitle through and reports a skipped email', async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, user_id: 'd1', email_sent: false }, error: null })
    from.mockImplementation(() => mockQueryBuilder({ data: profileRow }))

    const result = await createDiverAccount({ email: 'j@e.com', name: 'Jane', eventTitle: 'Green Island' })

    expect(result.emailSent).toBe(false)
    expect((invoke.mock.calls[0][1] as { body: Record<string, unknown> }).body.event_title).toBe('Green Island')
  })

  it('throws the generic message when the error has no readable context', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    await expect(createDiverAccount({ email: 'j@e.com', name: 'Jane' })).rejects.toThrow('boom')
  })

  it('surfaces the server error body buried in a FunctionsHttpError context', async () => {
    // supabase-js hides the real reason behind "non-2xx"; the JSON body is in
    // .context. The helper must dig it out (this is what an admin sees locally
    // when re-using an email that already has an account).
    const context = { json: async () => ({ error: 'A user with this email address has already been registered' }) }
    invoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { name: 'FunctionsHttpError', context }),
    })
    await expect(createDiverAccount({ email: 'j@e.com', name: 'Jane' }))
      .rejects.toThrow('already been registered')
  })

  it('throws when the function returns not-ok', async () => {
    invoke.mockResolvedValueOnce({ data: { ok: false, user_id: '', email_sent: false }, error: null })
    await expect(createDiverAccount({ email: 'j@e.com', name: 'Jane' })).rejects.toThrow(ad.createFailed)
  })

  it('throws when the profile refetch fails', async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, user_id: 'd1', email_sent: true }, error: null })
    from.mockImplementation(() => mockQueryBuilder({ data: null, error: { message: 'no row' } }))
    await expect(createDiverAccount({ email: 'j@e.com', name: 'Jane' })).rejects.toThrow('no row')
  })
})
