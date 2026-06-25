import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'
import type { DiveLog, DiveLogInsert } from '../types/database'
import {
  fetchDiveLogs,
  createDiveLog,
  updateDiveLog,
  deleteDiveLog,
  getLastExportRequestAt,
  nextExportAvailableAt,
  requestExport,
} from './dive-logs'

const { from, invoke } = vi.hoisted(() => ({ from: vi.fn(), invoke: vi.fn() }))

vi.mock('./supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => from(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}))

beforeEach(() => {
  from.mockReset()
  invoke.mockReset()
})

const sampleLog = {
  id: 'dl1',
  user_id: 'u1',
  dive_number: 7,
  dived_on: '2026-06-01',
  site: 'Green Island',
} as unknown as DiveLog

describe('fetchDiveLogs', () => {
  it('queries dive_logs for the user, newest first, and returns the rows', async () => {
    const builder = mockQueryBuilder<DiveLog[]>({ data: [sampleLog] })
    const eq = vi.spyOn(builder, 'eq' as never)
    const order = vi.spyOn(builder, 'order' as never)
    from.mockReturnValue(builder)

    const rows = await fetchDiveLogs('u1')

    expect(from).toHaveBeenCalledWith('dive_logs')
    expect(eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(order).toHaveBeenCalledWith('dived_on', { ascending: false })
    expect(order).toHaveBeenCalledWith('dive_number', { ascending: false })
    expect(rows).toEqual([sampleLog])
  })

  it('coerces a null result to an empty array', async () => {
    from.mockReturnValue(mockQueryBuilder<DiveLog[]>({ data: null }))
    expect(await fetchDiveLogs('u1')).toEqual([])
  })

  it('throws when the query errors', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: null, error: { message: 'boom' } }))
    await expect(fetchDiveLogs('u1')).rejects.toEqual({ message: 'boom' })
  })
})

describe('createDiveLog', () => {
  const row = { user_id: 'u1', dived_on: '2026-06-01', site: 'Green Island' } as DiveLogInsert

  it('inserts the row and returns the created log', async () => {
    const builder = mockQueryBuilder<DiveLog>({ data: sampleLog })
    const insert = vi.spyOn(builder, 'insert' as never)
    from.mockReturnValue(builder)

    const created = await createDiveLog(row)

    expect(from).toHaveBeenCalledWith('dive_logs')
    expect(insert).toHaveBeenCalledWith(row)
    expect(created).toEqual(sampleLog)
  })

  it('throws when the insert errors', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: null, error: { message: 'nope' } }))
    await expect(createDiveLog(row)).rejects.toEqual({ message: 'nope' })
  })
})

describe('updateDiveLog', () => {
  it('updates the matched id and returns the patched log', async () => {
    const builder = mockQueryBuilder<DiveLog>({ data: sampleLog })
    const update = vi.spyOn(builder, 'update' as never)
    const eq = vi.spyOn(builder, 'eq' as never)
    from.mockReturnValue(builder)

    const patch = { site: 'Shitiping' }
    const updated = await updateDiveLog('dl1', patch)

    expect(from).toHaveBeenCalledWith('dive_logs')
    expect(update).toHaveBeenCalledWith(patch)
    expect(eq).toHaveBeenCalledWith('id', 'dl1')
    expect(updated).toEqual(sampleLog)
  })

  it('throws when the update errors', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: null, error: { message: 'denied' } }))
    await expect(updateDiveLog('dl1', { site: 'x' })).rejects.toEqual({ message: 'denied' })
  })
})

describe('deleteDiveLog', () => {
  it('deletes the matched id', async () => {
    const builder = mockQueryBuilder({ data: null })
    const del = vi.spyOn(builder, 'delete' as never)
    const eq = vi.spyOn(builder, 'eq' as never)
    from.mockReturnValue(builder)

    await deleteDiveLog('dl1')

    expect(from).toHaveBeenCalledWith('dive_logs')
    expect(del).toHaveBeenCalled()
    expect(eq).toHaveBeenCalledWith('id', 'dl1')
  })

  it('throws when the delete errors', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: null, error: { message: 'rls' } }))
    await expect(deleteDiveLog('dl1')).rejects.toEqual({ message: 'rls' })
  })
})

describe('getLastExportRequestAt', () => {
  it('returns the most recent requested_at as a Date', async () => {
    const builder = mockQueryBuilder({ data: [{ requested_at: '2026-06-01T00:00:00.000Z' }] })
    const eq = vi.spyOn(builder, 'eq' as never)
    const order = vi.spyOn(builder, 'order' as never)
    from.mockReturnValue(builder)

    const at = await getLastExportRequestAt('u1')

    expect(from).toHaveBeenCalledWith('dive_log_export_requests')
    expect(eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(order).toHaveBeenCalledWith('requested_at', { ascending: false })
    expect(at).toEqual(new Date('2026-06-01T00:00:00.000Z'))
  })

  it('returns null when the diver has never requested an export', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: [] }))
    expect(await getLastExportRequestAt('u1')).toBeNull()
  })

  it('returns null when data is null', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: null }))
    expect(await getLastExportRequestAt('u1')).toBeNull()
  })

  it('throws when the query errors', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: null, error: { message: 'boom' } }))
    await expect(getLastExportRequestAt('u1')).rejects.toEqual({ message: 'boom' })
  })
})

describe('nextExportAvailableAt', () => {
  const NOW = new Date('2026-06-25T12:00:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when there is no prior request (available now)', () => {
    expect(nextExportAvailableAt(null)).toBeNull()
  })

  it('returns the timestamp 24h after a request made within the cooldown window', () => {
    const last = new Date('2026-06-25T06:00:00.000Z') // 6h ago
    expect(nextExportAvailableAt(last)).toEqual(new Date('2026-06-26T06:00:00.000Z'))
  })

  it('returns null at exactly the 24h boundary (cooldown elapsed)', () => {
    const last = new Date(NOW.getTime() - 24 * 3600 * 1000)
    // next === now, and the check is strictly greater-than, so it is available.
    expect(nextExportAvailableAt(last)).toBeNull()
  })

  it('returns the future timestamp one second before the boundary', () => {
    const last = new Date(NOW.getTime() - (24 * 3600 - 1) * 1000)
    expect(nextExportAvailableAt(last)).toEqual(new Date(last.getTime() + 24 * 3600 * 1000))
  })

  it('returns null for a request older than the cooldown', () => {
    const last = new Date('2026-06-23T12:00:00.000Z') // 48h ago
    expect(nextExportAvailableAt(last)).toBeNull()
  })
})

describe('requestExport', () => {
  it('invokes the edge function with an empty body and returns its data', async () => {
    invoke.mockResolvedValue({ data: { ok: true, dive_count: 12 }, error: null })

    const res = await requestExport()

    expect(invoke).toHaveBeenCalledWith('request-dive-log-export', { body: {} })
    expect(res).toEqual({ ok: true, dive_count: 12 })
  })

  it('extracts the human-readable error from FunctionsHttpError.context', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: { json: async () => ({ error: 'You can request another export in 18 hours.', retry_after_seconds: 64800 }) },
      },
    })

    const err = await requestExport().then(() => null, (e) => e as Error)
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toBe('You can request another export in 18 hours.')
    expect(err?.message).not.toBe('[object Object]')
  })

  it('falls back to the transport error message when context has no body error', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: 'network down', context: { json: async () => ({}) } },
    })
    await expect(requestExport()).rejects.toThrow('network down')
  })

  it('falls back to the transport error message when there is no context', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(requestExport()).rejects.toThrow('boom')
  })

  // Surprise: when context.json() rejects with an Error, the catch re-throws
  // that Error (it is `instanceof Error`) rather than falling through to the
  // transport message. So the parse-failure surfaces as the json() error, not
  // error.message.
  it('re-throws a json() Error instead of falling back to the transport message', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: 'bad gateway', context: { json: async () => { throw new Error('not json') } } },
    })
    await expect(requestExport()).rejects.toThrow('not json')
  })

  it('falls back to the transport message when context.json rejects with a non-Error', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: 'bad gateway', context: { json: async () => { throw 'not json' } } },
    })
    await expect(requestExport()).rejects.toThrow('bad gateway')
  })
})
