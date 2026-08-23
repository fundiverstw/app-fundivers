import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'

const from = vi.fn()
vi.mock('./supabase', () => ({ supabase: { from: (t: string) => from(t) } }))

const LABELS = { system: 'system', unknown: (s: string) => `unknown (${s})` }

beforeEach(() => { vi.resetModules(); from.mockReset() })

describe('fetchActorNames', () => {
  it('looks up each distinct id once and maps it to a display name', async () => {
    const inSpy = vi.fn()
    const builder = mockQueryBuilder({
      data: [{ id: 'a1', name: 'Ada Admin', nickname: 'Ada' }],
      error: null,
    })
    builder.in = (col: string, vals: string[]) => { inSpy(col, vals); return builder }
    from.mockReturnValue(builder)

    const { fetchActorNames } = await import('./actor-names')
    const names = await fetchActorNames(['a1', 'a1', null, undefined, 'a2'])

    expect(inSpy).toHaveBeenCalledWith('id', ['a1', 'a2'])
    expect(names.get('a1')).toBe('Ada Admin (Ada)')
  })

  it('does not query at all when there is nothing to resolve', async () => {
    const { fetchActorNames } = await import('./actor-names')
    expect((await fetchActorNames([null, undefined])).size).toBe(0)
    expect(from).not.toHaveBeenCalled()
  })

  it('throws rather than silently returning half a map', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: null, error: { message: 'denied' } }))
    const { fetchActorNames } = await import('./actor-names')
    await expect(fetchActorNames(['a1'])).rejects.toBeTruthy()
  })
})

describe('actorLabel', () => {
  it('names the person when we know them', async () => {
    const { actorLabel } = await import('./actor-names')
    expect(actorLabel(new Map([['a1', 'Ada']]), 'a1', LABELS)).toBe('Ada')
  })

  // A null actor is a trigger, a migration or the push worker -- saying
  // "unknown" there would imply a person we failed to identify.
  it('calls an unattributed act the system, not an unknown person', async () => {
    const { actorLabel } = await import('./actor-names')
    expect(actorLabel(new Map(), null, LABELS)).toBe('system')
  })

  it('keeps enough of an unresolvable id to tell two of them apart', async () => {
    const { actorLabel } = await import('./actor-names')
    expect(actorLabel(new Map(), 'deadbeef-1111-2222-3333-444444444444', LABELS))
      .toBe('unknown (deadbeef)')
  })
})
