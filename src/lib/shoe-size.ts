// Shoe size conversion table ported from the Wix registration form.
// Rows are parallel size lines; columns are the five supported units.
// JP is the canonical "body" reference (cm of foot length); everything else
// is nearest-match across the row.

export type ShoeUnit = 'eu' | 'us' | 'uk' | 'jp' | 'cm'
export type ShoeGender = 'm' | 'f'

export const SHOE_UNITS: readonly ShoeUnit[] = ['eu', 'us', 'uk', 'jp', 'cm']
export const SHOE_GENDERS: readonly ShoeGender[] = ['m', 'f']

const SHOE_COL: Record<ShoeUnit, number> = { jp: 0, cm: 1, us: 2, uk: 3, eu: 4 }

const SHOE_TABLE: Record<ShoeGender, number[][]> = {
  f: [
    [21, 22.8, 5, 2.5, 35], [21.5, 23.1, 5.5, 3, 35.5], [22, 23.5, 6, 3.5, 36],
    [22.5, 23.8, 6.5, 4, 37], [23, 24.1, 7, 4.5, 37.5], [23.5, 24.5, 7.5, 5, 38],
    [24, 24.8, 8, 5.5, 38.5], [24.5, 25.1, 8.5, 6, 39], [25, 25.4, 9, 6.5, 40],
    [25.5, 25.7, 9.5, 7, 41], [26, 26, 10, 7.5, 42], [27, 26.7, 10.5, 8, 43],
    [28, 27.3, 12, 9.5, 44], [29, 27.9, 13, 10.5, 45], [30, 28.6, 14, 11.5, 46.5],
    [31, 29.2, 15.5, 13, 48.5],
  ],
  m: [
    [21.5, 22.8, 3.5, 3, 35], [22, 23.1, 4, 3.5, 35.5], [22.5, 23.5, 4.5, 4, 36],
    [23, 23.8, 5, 4.5, 37], [23.5, 24.1, 5.5, 5, 37.5], [24, 24.5, 6, 5.5, 38],
    [24.5, 24.8, 6.5, 6, 38.5], [25, 25.1, 7, 6.5, 39], [25.5, 25.4, 7.5, 7, 40],
    [26, 25.7, 8, 7.5, 41], [26.5, 26, 8.5, 8, 42], [27, 26.3, 9, 8.5, 43],
    [27.5, 26.7, 9.5, 9, 43.5], [28, 27, 10, 9.5, 44], [28.5, 27.3, 10.5, 10, 44.5],
    [29, 27.6, 11, 10.5, 45], [29.5, 27.9, 11.5, 11, 45.5], [30, 28.3, 12, 11.5, 46],
    [30.5, 28.6, 12.5, 12, 46.5], [31, 28.9, 13, 12.5, 47], [31.5, 29.2, 13.5, 13, 47.5],
  ],
}

export function shoeSizesFor(unit: ShoeUnit, gender: ShoeGender): number[] {
  const col = SHOE_COL[unit]
  return SHOE_TABLE[gender].map(row => row[col])
}

export function convertShoeSize(
  value: number,
  fromUnit: ShoeUnit,
  toUnit: ShoeUnit,
  gender: ShoeGender,
): number | null {
  if (!Number.isFinite(value)) return null
  if (fromUnit === toUnit) return value
  const table = SHOE_TABLE[gender]
  const fromCol = SHOE_COL[fromUnit]
  const toCol = SHOE_COL[toUnit]
  let best: number[] | null = null
  let bestDiff = Infinity
  for (const row of table) {
    const diff = Math.abs(row[fromCol] - value)
    if (diff < bestDiff) { bestDiff = diff; best = row }
  }
  return best ? best[toCol] : null
}

// Canonical storage string, e.g. "EU 41 M". Gender is preserved so the
// picker can round-trip its selection on the next profile edit.
export function formatShoeSize(value: number, unit: ShoeUnit, gender: ShoeGender): string {
  return `${unit.toUpperCase()} ${value} ${gender.toUpperCase()}`
}

// Display helper: shoe size expressed in Japanese (JP) for admin surfaces.
// The shop packs by JP/body size. Returns null for empty/unparseable input
// so callers can fall back to their own placeholder.
export function shoeAsJp(raw: string | null | undefined): string | null {
  const parsed = parseShoeSize(raw)
  if (!parsed) return null
  const jp = convertShoeSize(parsed.value, parsed.unit, 'jp', parsed.gender)
  return jp != null ? `JP ${jp}` : null
}

// Accepts both the new canonical format ("EU 41 M") and the older loose
// strings users typed before the picker existed ("EU 41", "41", "US 9").
export function parseShoeSize(text: string | null | undefined):
  | { value: number; unit: ShoeUnit; gender: ShoeGender }
  | null
{
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^(EU|US|UK|JP|CM)?\s*(\d+(?:\.\d+)?)\s*(M|F)?/i)
  if (!match) return null
  const value = parseFloat(match[2])
  if (!Number.isFinite(value)) return null
  const unit = (match[1]?.toLowerCase() ?? 'eu') as ShoeUnit
  const gender = (match[3]?.toLowerCase() ?? 'm') as ShoeGender
  if (!SHOE_UNITS.includes(unit)) return null
  return { value, unit, gender }
}
