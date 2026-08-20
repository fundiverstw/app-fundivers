import { useId } from 'react'
import { DateField } from '../DateField'
import { PasswordInput } from '../PasswordInput'

// The labelled input both registration flows are built from — the solo
// RegisterForm and the multi-event cart each had their own copy, identical but
// for the branches one of them happened to need.
export function TextField({
  label, value, onChange, type = 'text', required, placeholder, min, step, hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: 'text' | 'email' | 'tel' | 'number' | 'date' | 'password'
  required?: boolean
  placeholder?: string
  min?: number
  /** Passed straight to a number input -- '0.1' for a measurement the diver
   *  may well give with a decimal, since the browser rejects a value off-step. */
  step?: string
  /** Rendered under the input, for a field whose label can't carry the whole
   *  requirement on its own (which name to give, which format). */
  hint?: string
}) {
  // Associates by id rather than by wrapping: a date field renders a second,
  // transparent native input for the OS picker, and a wrapping label would
  // claim that one too — ambiguous for screen readers and for tests querying
  // by label.
  const id = useId()
  const inputClass = 'w-full bg-white border border-surface-300 rounded-lg px-2 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'
  return (
    <div className="block">
      <label htmlFor={id} className="block text-xs text-brand-900 font-medium mb-1">{label}</label>
      {type === 'date' ? (
        <DateField id={id} value={value} onChange={onChange} required={required} className={inputClass} />
      ) : type === 'password' ? (
        <PasswordInput
          id={id}
          value={value}
          onChange={e => onChange(e.target.value)}
          required={required}
          placeholder={placeholder}
          className={inputClass}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          required={required}
          placeholder={placeholder}
          min={min}
          step={step}
          className={inputClass}
        />
      )}
      {hint && <span className="block text-xs text-brand-900/70 mt-1">{hint}</span>}
    </div>
  )
}
