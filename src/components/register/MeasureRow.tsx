// The label + hint shell TextField draws, without the input — so a height or
// weight field can sit in the registration grid alongside plain text fields
// and look like one of them, while HeightField / WeightField supply their own
// multi-box, unit-toggling innards.

export const MEASURE_INPUT =
  'w-full bg-white border border-surface-300 rounded-lg px-2 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

/** Both registration forms hold measurements as form strings (that's what the
 *  localStorage draft persists). This is the one place that turns a blank or
 *  unparseable one into the null the measurement fields expect. */
export function numOrNullStr(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

export function MeasureRow({ label, hint, children }: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="block">
      <span className="block text-xs text-brand-900 font-medium mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-brand-900/70 mt-1">{hint}</span>}
    </div>
  )
}
