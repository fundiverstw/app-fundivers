import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyWaitlistConfirmed } from './booking-notifications'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}))

const invoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ data: { ok: true, sent: true }, error: null })
})

describe('notifyWaitlistConfirmed', () => {
  it('asks the edge function to email the diver for that booking', async () => {
    await notifyWaitlistConfirmed('b1')
    expect(invoke).toHaveBeenCalledWith('notify-booking-confirmed', { body: { booking_id: 'b1' } })
  })

  it('throws when the send fails, so the caller can say the email did not go', async () => {
    // The booking is already confirmed at this point — the caller reports the
    // failed email rather than pretending the promotion itself broke.
    invoke.mockResolvedValue({ data: null, error: new Error('smtp down') })
    await expect(notifyWaitlistConfirmed('b1')).rejects.toThrow('smtp down')
  })
})
