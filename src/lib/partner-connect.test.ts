import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendPartnerConnectRequest } from './partner-connect'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))
const invoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>
beforeEach(() => invoke.mockReset())

describe('sendPartnerConnectRequest', () => {
  it('invokes partner-connect with destination + note', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await sendPartnerConnectRequest({ destination: 'Cebu', note: 'March' })
    expect(invoke).toHaveBeenCalledWith('partner-connect', { body: { destination: 'Cebu', note: 'March' } })
  })

  it('defaults note to empty string when omitted', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await sendPartnerConnectRequest({ destination: 'Okinawa' })
    expect(invoke).toHaveBeenCalledWith('partner-connect', { body: { destination: 'Okinawa', note: '' } })
  })

  it('throws the edge function error body when present', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'Tell us where you want to go.' }) } },
    })
    await expect(sendPartnerConnectRequest({ destination: '' })).rejects.toThrow('Tell us where you want to go.')
  })

  it('falls back to the transport error message', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'network down' } })
    await expect(sendPartnerConnectRequest({ destination: 'Bali' })).rejects.toThrow('network down')
  })
})
