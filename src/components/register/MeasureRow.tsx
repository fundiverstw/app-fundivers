// The label + hint shell TextField draws, without the input — so a height or
// weight field can sit in the registration grid alongside plain text fields
// and look like one of them, while HeightField / WeightField supply their own
// multi-box, unit-toggling innards.

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
