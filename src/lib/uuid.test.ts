import { describe, it, expect } from 'vitest'
import { isUuid, uniqueUuids } from './uuid'

describe('isUuid', () => {
  it('accepts canonical UUIDs (any case)', () => {
    expect(isUuid('0e299749-8b3d-4d0b-9655-cf2b146c3570')).toBe(true)
    expect(isUuid('0E299749-8B3D-4D0B-9655-CF2B146C3570')).toBe(true)
  })

  it('rejects non-UUID strings and non-strings', () => {
    expect(isUuid('')).toBe(false)
    expect(isUuid('1699999999999x999999999999999999')).toBe(false)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid(null)).toBe(false)
    expect(isUuid(undefined)).toBe(false)
    expect(isUuid(42)).toBe(false)
  })
})

describe('uniqueUuids', () => {
  it('keeps only valid UUIDs, deduped', () => {
    expect(uniqueUuids([
      '0e299749-8b3d-4d0b-9655-cf2b146c3570',
      '0e299749-8b3d-4d0b-9655-cf2b146c3570',
      '5165524d-4b81-4614-88f4-cff472951ea9',
    ])).toEqual([
      '0e299749-8b3d-4d0b-9655-cf2b146c3570',
      '5165524d-4b81-4614-88f4-cff472951ea9',
    ])
  })

  it('drops malformed, empty, null and undefined ids so one bad value cannot poison the batch', () => {
    expect(uniqueUuids([
      '0e299749-8b3d-4d0b-9655-cf2b146c3570',
      '',
      'legacy-bubble-id',
      null,
      undefined,
    ])).toEqual(['0e299749-8b3d-4d0b-9655-cf2b146c3570'])
  })
})
