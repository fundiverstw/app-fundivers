import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'
import { fetchPackedKeys, subscribePacked, writePacked } from './packed-sync'

const { from, channel, removeChannel } = vi.hoisted(() => ({
  from: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
}))
vi.mock('./supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => from(...a),
    channel: (...a: unknown[]) => channel(...a),
    removeChannel: (...a: unknown[]) => removeChannel(...a),
  },
}))

/** A query builder that records every call made on it. */
function recording(result: { data?: unknown; error?: { message: string } | null } = {}) {
  const calls: Array<[string, unknown[]]> = []
  const b = mockQueryBuilder(result) as Record<string, unknown>
  for (const m of ['select', 'eq', 'in', 'upsert', 'delete']) {
    b[m] = (...a: unknown[]) => { calls.push([m, a]); return b }
  }
  return { builder: b, calls }
}

beforeEach(() => { from.mockReset(); channel.mockReset(); removeChannel.mockReset() })

describe('fetchPackedKeys', () => {
  it("reads the day's rows as piece keys", async () => {
    const { builder, calls } = recording({ data: [{ booking_id: 'b1', item: 'BCD' }, { booking_id: 'b2', item: 'Fins' }] })
    from.mockReturnValue(builder)
    await expect(fetchPackedKeys('2026-08-15')).resolves.toEqual(new Set(['b1|BCD', 'b2|Fins']))
    expect(from).toHaveBeenCalledWith('packed_pieces')
    expect(calls).toContainEqual(['eq', ['pack_day', '2026-08-15']])
  })

  it('throws on a failed read rather than answering "nothing packed"', async () => {
    from.mockReturnValue(recording({ error: { message: 'boom' } }).builder)
    await expect(fetchPackedKeys('2026-08-15')).rejects.toThrow('boom')
  })
})

describe('writePacked', () => {
  it('ticks with one upsert that skips pieces already on the list', async () => {
    const { builder, calls } = recording()
    from.mockReturnValue(builder)
    await writePacked('2026-08-15', ['b1|BCD', 'b2|Fins'], true)
    expect(calls).toEqual([['upsert', [
      [
        { pack_day: '2026-08-15', booking_id: 'b1', item: 'BCD' },
        { pack_day: '2026-08-15', booking_id: 'b2', item: 'Fins' },
      ],
      { onConflict: 'pack_day,booking_id,item', ignoreDuplicates: true },
    ]]])
  })

  it('unticks with one delete per guest', async () => {
    const recs = [recording(), recording()]
    from.mockReturnValueOnce(recs[0].builder).mockReturnValueOnce(recs[1].builder)
    await writePacked('2026-08-15', ['b1|BCD', 'b1|Fins', 'b2|Mask'], false)
    expect(recs[0].calls).toEqual([
      ['delete', []], ['eq', ['pack_day', '2026-08-15']], ['eq', ['booking_id', 'b1']], ['in', ['item', ['BCD', 'Fins']]],
    ])
    expect(recs[1].calls).toContainEqual(['in', ['item', ['Mask']]])
  })

  it('throws when the server refuses, so the caller keeps the tick queued', async () => {
    from.mockReturnValue(recording({ error: { message: 'denied' } }).builder)
    await expect(writePacked('2026-08-15', ['b1|BCD'], true)).rejects.toThrow('denied')
  })

  it('makes no request for nothing', async () => {
    await writePacked('2026-08-15', [], true)
    expect(from).not.toHaveBeenCalled()
  })
})

describe('subscribePacked', () => {
  function fakeChannel() {
    const handlers: Array<{ filter: Record<string, unknown>; cb: (p: unknown) => void }> = []
    const ch = {
      on: (_type: string, filter: Record<string, unknown>, cb: (p: unknown) => void) => { handlers.push({ filter, cb }); return ch },
      subscribe: () => ch,
    }
    return { ch, handlers }
  }

  it("hears ticks on its day, and unticks — matched to the day by the deleted row's key", () => {
    const { ch, handlers } = fakeChannel()
    channel.mockReturnValue(ch)
    const onChange = vi.fn()
    const stop = subscribePacked('2026-08-15', onChange)

    const insert = handlers.find(h => h.filter.event === 'INSERT')!
    expect(insert.filter.filter).toBe('pack_day=eq.2026-08-15')
    insert.cb({ new: { pack_day: '2026-08-15', booking_id: 'b1', item: 'BCD' } })

    const del = handlers.find(h => h.filter.event === 'DELETE')!
    del.cb({ old: { pack_day: '2026-08-15', booking_id: 'b1', item: 'BCD' } })
    del.cb({ old: { pack_day: '2026-08-16', booking_id: 'b9', item: 'Fins' } })

    expect(onChange.mock.calls).toEqual([['b1|BCD', true], ['b1|BCD', false]])
    stop()
    expect(removeChannel).toHaveBeenCalledWith(ch)
  })
})
