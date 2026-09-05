import { describe, it, expect, vi } from 'vitest'
import { fetchAllRows } from './fetch-all'

function pagedSource(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }))
  const ranges: Array<[number, number]> = []
  const read = vi.fn(async (from: number, to: number) => {
    ranges.push([from, to])
    return { data: rows.slice(from, to + 1), error: null }
  })
  return { read, ranges }
}

describe('fetchAllRows', () => {
  it('returns a single page without asking for a second', async () => {
    const { read, ranges } = pagedSource(3)
    expect(await fetchAllRows(read, 10)).toHaveLength(3)
    expect(ranges).toEqual([[0, 9]])
  })

  it('keeps reading past the row cap until a page comes back short', async () => {
    const { read, ranges } = pagedSource(25)
    const rows = await fetchAllRows(read, 10)
    expect(rows).toHaveLength(25)
    expect(rows.map(r => r.id)).toEqual(Array.from({ length: 25 }, (_, i) => i))
    expect(ranges).toEqual([[0, 9], [10, 19], [20, 29]])
  })

  it('asks once more when the last page is exactly full — a full page could be the cap', async () => {
    const { read, ranges } = pagedSource(20)
    expect(await fetchAllRows(read, 10)).toHaveLength(20)
    expect(ranges).toEqual([[0, 9], [10, 19], [20, 29]])
  })

  it('throws rather than returning a partial answer', async () => {
    const read = vi.fn(async () => ({ data: null, error: { message: 'permission denied' } }))
    await expect(fetchAllRows(read, 10)).rejects.toThrow(/permission denied/)
  })
})
