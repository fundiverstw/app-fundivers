import { useMemo, useState } from 'react'
import {
  SHOE_UNITS, SHOE_GENDERS, shoeSizesFor, convertShoeSize, formatShoeSize, parseShoeSize,
  type ShoeUnit, type ShoeGender,
} from '../lib/shoe-size'

const SELECT = 'bg-white border border-surface-300 rounded-lg px-1.5 py-2 text-brand-900 text-sm focus:outline-none focus:border-brand-900'

/**
 * Unit / gender / value shoe-size picker. Owns its own unit+gender display
 * state (seeded once from `initial`) and emits the canonical string (e.g.
 * "EU 41 M", or '' when cleared) via `onChange`. Switching unit/gender snaps
 * the current size to the nearest row in the new unit so the physical size is
 * preserved. Shared by the profile form and the registration gear step.
 */
export function ShoeSizeField({ initial, onChange }: {
  initial?: string | null
  onChange: (canonical: string) => void
}) {
  // Seeded once — thereafter the picker owns its state and reports up.
  const seed = useMemo(() => parseShoeSize(initial), [])  // eslint-disable-line react-hooks/exhaustive-deps
  const [unit, setUnit] = useState<ShoeUnit>(seed?.unit ?? 'eu')
  const [gender, setGender] = useState<ShoeGender>(seed?.gender ?? 'm')
  const [value, setValue] = useState<string>(seed ? String(seed.value) : '')

  const options = useMemo(() => shoeSizesFor(unit, gender), [unit, gender])
  const jpHint = useMemo(() => {
    if (!value || unit === 'jp') return null
    const jp = convertShoeSize(parseFloat(value), unit, 'jp', gender)
    return jp != null ? `JP: ${jp}` : null
  }, [value, unit, gender])

  function emit(v: string, u: ShoeUnit, g: ShoeGender) {
    onChange(v ? formatShoeSize(parseFloat(v), u, g) : '')
  }

  function changeUnit(next: ShoeUnit) {
    let v = value
    if (value) {
      const conv = convertShoeSize(parseFloat(value), unit, next, gender)
      if (conv != null) { v = String(conv); setValue(v) }
    }
    setUnit(next)
    emit(v, next, gender)
  }
  function changeGender(next: ShoeGender) {
    let v = value
    if (value) {
      // Map through JP (body reference) so the physical size is preserved.
      const asJp = convertShoeSize(parseFloat(value), unit, 'jp', gender)
      const back = asJp != null ? convertShoeSize(asJp, 'jp', unit, next) : null
      if (back != null) { v = String(back); setValue(v) }
    }
    setGender(next)
    emit(v, unit, next)
  }
  function changeValue(next: string) {
    setValue(next)
    emit(next, unit, gender)
  }

  return (
    <div>
      <div className="flex gap-1.5">
        <select aria-label="Shoe size unit" value={unit} onChange={e => changeUnit(e.target.value as ShoeUnit)} className={`shrink-0 w-16 ${SELECT}`}>
          {SHOE_UNITS.map(u => <option key={u} value={u}>{u.toUpperCase()}</option>)}
        </select>
        <select aria-label="Shoe size gender" value={gender} onChange={e => changeGender(e.target.value as ShoeGender)} className={`shrink-0 w-14 ${SELECT}`}>
          {SHOE_GENDERS.map(g => <option key={g} value={g}>{g.toUpperCase()}</option>)}
        </select>
        <select aria-label="Shoe size value" value={value} onChange={e => changeValue(e.target.value)} className={`flex-1 min-w-0 ${SELECT}`}>
          <option value="">—</option>
          {options.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {jpHint && <p className="text-xs text-red-600 mt-1">{jpHint}</p>}
    </div>
  )
}
