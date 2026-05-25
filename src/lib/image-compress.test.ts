import { describe, it, expect } from 'vitest'
import { computeTargetSize, isHeicFile } from './image-compress'

describe('computeTargetSize', () => {
  it('leaves small images untouched', () => {
    expect(computeTargetSize(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })

  it('scales the longer edge to maxDim (landscape)', () => {
    expect(computeTargetSize(3200, 2400, 1600)).toEqual({ width: 1600, height: 1200 })
  })

  it('scales the longer edge to maxDim (portrait)', () => {
    expect(computeTargetSize(2400, 3200, 1600)).toEqual({ width: 1200, height: 1600 })
  })

  it('rounds to integers', () => {
    // 1500/900 → 1.667 scale → 900 * (1600/1500) = 960, 1500 → 1600
    expect(computeTargetSize(1500, 900, 1600)).toEqual({ width: 1500, height: 900 })
    // 3001 → need to scale to 1600 exactly
    const out = computeTargetSize(3001, 1000, 1600)
    expect(out.width).toBe(1600)
    expect(Number.isInteger(out.width)).toBe(true)
    expect(Number.isInteger(out.height)).toBe(true)
  })

  it('returns zeros for invalid input', () => {
    expect(computeTargetSize(0, 100, 1600)).toEqual({ width: 0, height: 0 })
    expect(computeTargetSize(100, 0, 1600)).toEqual({ width: 0, height: 0 })
    expect(computeTargetSize(-50, 100, 1600)).toEqual({ width: 0, height: 0 })
  })
})

describe('isHeicFile', () => {
  it('matches the HEIC/HEIF mime types', () => {
    expect(isHeicFile({ type: 'image/heic' })).toBe(true)
    expect(isHeicFile({ type: 'image/heif' })).toBe(true)
    expect(isHeicFile({ type: 'image/heic-sequence' })).toBe(true)
    expect(isHeicFile({ type: 'image/heif-sequence' })).toBe(true)
  })

  it('is case-insensitive on mime', () => {
    expect(isHeicFile({ type: 'IMAGE/HEIC' })).toBe(true)
  })

  it('falls back to extension when iOS sends an empty or generic mime', () => {
    expect(isHeicFile({ type: '', name: 'IMG_1234.HEIC' })).toBe(true)
    expect(isHeicFile({ type: 'application/octet-stream', name: 'photo.heif' })).toBe(true)
  })

  it('rejects regular images', () => {
    expect(isHeicFile({ type: 'image/jpeg', name: 'photo.jpg' })).toBe(false)
    expect(isHeicFile({ type: 'image/png', name: 'card.png' })).toBe(false)
    expect(isHeicFile({ type: 'image/webp', name: 'card.webp' })).toBe(false)
  })

  it('tolerates missing fields', () => {
    expect(isHeicFile({})).toBe(false)
  })
})
