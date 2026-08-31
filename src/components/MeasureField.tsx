import { useEffect, useState } from 'react'
import {
  readUnitSystem, writeUnitSystem,
  cmToFeetInches, feetInchesToCm, kgToLb, lbToKg, sameHeight, sameWeight,
  type UnitSystem,
} from '../lib/units'
import { t } from '../i18n'

// Height and weight inputs that speak whichever units the diver thinks in.
//
// Both fields report the canonical metric value up (cm / kg) — the caller
// stores exactly what it stored before, and gear-sizing.ts, the admin screens
// and the PDF exports are untouched. Only the typing surface changes.
//
// The unit choice is shared, not per-field: a diver who switches height to feet
// wants pounds too, and having to flip two toggles is the kind of small
// friction that made the old form annoying. Both fields read the same
// localStorage preference and a `unitsystemchange` window event keeps every
// mounted field in step within the page, since a plain state hook in each one
// would leave the second field on the old unit until remount.

const UNIT_EVENT = 'fundive:unitsystemchange'

function broadcast(system: UnitSystem) {
  writeUnitSystem(system)
  window.dispatchEvent(new CustomEvent<UnitSystem>(UNIT_EVENT, { detail: system }))
}

/** The page-wide unit preference, kept in step across every mounted field. */
function useUnitSystem(): [UnitSystem, (next: UnitSystem) => void] {
  const [system, setSystem] = useState<UnitSystem>(readUnitSystem)

  useEffect(() => {
    const onChange = (e: Event) => setSystem((e as CustomEvent<UnitSystem>).detail)
    window.addEventListener(UNIT_EVENT, onChange)
    return () => window.removeEventListener(UNIT_EVENT, onChange)
  }, [])

  return [system, broadcast]
}

const TOGGLE_BASE = 'px-2 py-1 text-xs font-semibold transition-colors'

function UnitToggle({ system, onChange }: { system: UnitSystem; onChange: (s: UnitSystem) => void }) {
  return (
    <div
      role="group"
      aria-label={t.a11y.unitSystem}
      className="shrink-0 inline-flex rounded-lg border border-surface-300 overflow-hidden bg-white"
    >
      {(['metric', 'imperial'] as const).map(s => (
        <button
          key={s}
          type="button"
          aria-pressed={system === s}
          onClick={() => onChange(s)}
          className={`${TOGGLE_BASE} ${
            system === s
              ? 'bg-brand-900 text-white'
              : 'text-brand-900 hover:bg-surface-100'
          }`}
        >
          {s === 'metric' ? t.units.metricShort : t.units.imperialShort}
        </button>
      ))}
    </div>
  )
}

export interface HeightFieldProps {
  /** Stored height in centimeters, or null when unset. */
  valueCm: number | null
  /** Fires with the new canonical centimeters, or null when the field is cleared. */
  onChange: (cm: number | null) => void
  inputClassName: string
}

/**
 * Height in cm, or in feet + inches. Reports centimeters either way.
 *
 * The imperial side is two boxes rather than one decimal box because nobody
 * writes their height as 5.9 feet. Clearing *both* clears the measurement;
 * clearing one treats it as a zero, so 6 feet flat is 6 and an empty inches
 * box, not 6 and a typed 0.
 */
export function HeightField({ valueCm, onChange, inputClassName }: HeightFieldProps) {
  const [system, setSystem] = useUnitSystem()

  const seed = valueCm != null ? cmToFeetInches(valueCm) : null
  const [cm, setCm]         = useState(valueCm != null ? String(valueCm) : '')
  const [feet,   setFeet]   = useState(seed ? String(seed.feet)   : '')
  const [inches, setInches] = useState(seed ? String(seed.inches) : '')

  // Re-seed when the value underneath changes for a reason that isn't this
  // field — a profile row finishing its fetch, or a save round-tripping.
  // Adjusted during render rather than in an effect (React's documented
  // pattern for derived-from-props state) so the boxes never paint one frame
  // of the stale value.
  //
  // The sameHeight guard is what makes it safe to run on every prop change:
  // 180cm renders as 5'11", which converts back to 180.3, so re-seeding
  // unconditionally would let a diver's height creep every time they typed.
  const [prevCm, setPrevCm] = useState(valueCm)
  if (prevCm !== valueCm) {
    setPrevCm(valueCm)
    setCm(valueCm != null ? String(valueCm) : '')
    const typed = feet === '' && inches === ''
      ? null
      : { feet: Number(feet || 0), inches: Number(inches || 0) }
    if (!sameHeight(valueCm, typed)) {
      setFeet(seed   ? String(seed.feet)   : '')
      setInches(seed ? String(seed.inches) : '')
    }
  }

  function commitMetric(next: string) {
    setCm(next)
    const n = next.trim() === '' ? null : Number(next)
    onChange(n == null || Number.isNaN(n) ? null : n)
  }

  function commitImperial(nextFeet: string, nextInches: string) {
    setFeet(nextFeet)
    setInches(nextInches)
    if (nextFeet.trim() === '' && nextInches.trim() === '') { onChange(null); return }
    const f = Number(nextFeet   || 0)
    const i = Number(nextInches || 0)
    if (Number.isNaN(f) || Number.isNaN(i)) { onChange(null); return }
    onChange(feetInchesToCm({ feet: f, inches: i }))
  }

  return (
    <div className="flex gap-1.5">
      {system === 'metric' ? (
        <input
          aria-label={t.profile.heightCm}
          type="number"
          step="0.1"
          min="0"
          inputMode="decimal"
          value={cm}
          onChange={e => commitMetric(e.target.value)}
          className={`flex-1 min-w-0 ${inputClassName}`}
        />
      ) : (
        <>
          <input
            aria-label={t.units.heightFeet}
            type="number"
            step="1"
            min="0"
            inputMode="numeric"
            placeholder={t.units.ft}
            value={feet}
            onChange={e => commitImperial(e.target.value, inches)}
            className={`flex-1 min-w-0 ${inputClassName}`}
          />
          <input
            aria-label={t.units.heightInches}
            type="number"
            step="1"
            min="0"
            max="11"
            inputMode="numeric"
            placeholder={t.units.in}
            value={inches}
            onChange={e => commitImperial(feet, e.target.value)}
            className={`flex-1 min-w-0 ${inputClassName}`}
          />
        </>
      )}
      <UnitToggle system={system} onChange={setSystem} />
    </div>
  )
}

export interface WeightFieldProps {
  /** Stored weight in kilograms, or null when unset. */
  valueKg: number | null
  /** Fires with the new canonical kilograms, or null when the field is cleared. */
  onChange: (kg: number | null) => void
  inputClassName: string
}

/** Weight in kg, or in pounds. Reports kilograms either way. */
export function WeightField({ valueKg, onChange, inputClassName }: WeightFieldProps) {
  const [system, setSystem] = useUnitSystem()

  const [kg, setKg] = useState(valueKg != null ? String(valueKg) : '')
  const [lb, setLb] = useState(valueKg != null ? String(kgToLb(valueKg)) : '')

  // Same render-time re-seed as HeightField, guarded the same way — 70kg shows
  // as 154lb, which comes back as 69.9.
  const [prevKg, setPrevKg] = useState(valueKg)
  if (prevKg !== valueKg) {
    setPrevKg(valueKg)
    setKg(valueKg != null ? String(valueKg) : '')
    const typed = lb.trim() === '' ? null : Number(lb)
    if (!sameWeight(valueKg, typed)) {
      setLb(valueKg != null ? String(kgToLb(valueKg)) : '')
    }
  }

  function commit(next: string, from: UnitSystem) {
    if (from === 'metric') setKg(next); else setLb(next)
    if (next.trim() === '') { onChange(null); return }
    const n = Number(next)
    if (Number.isNaN(n)) { onChange(null); return }
    onChange(from === 'metric' ? n : lbToKg(n))
  }

  return (
    <div className="flex gap-1.5">
      <input
        aria-label={system === 'metric' ? t.profile.weightKg : t.units.weightLb}
        type="number"
        step="0.1"
        min="0"
        inputMode="decimal"
        value={system === 'metric' ? kg : lb}
        onChange={e => commit(e.target.value, system)}
        className={`flex-1 min-w-0 ${inputClassName}`}
      />
      <UnitToggle system={system} onChange={setSystem} />
    </div>
  )
}
