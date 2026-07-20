import { useEffect, useRef, useState } from 'react'
import { maskYmd, isValidYmd } from '../lib/date-input'
import { t } from '../i18n'

// A date input that can always be TYPED, not just picked from a calendar.
//
// Native <input type="date"> on some Android browsers only opens a
// calendar that scrolls one month at a time — miserable for picking a
// birth year decades back. This component keeps the value contract of the
// native input (a 'YYYY-MM-DD' string, or '' when empty/incomplete) but the
// primary control is a free-text field that auto-masks digits into
// YYYY-MM-DD. A transparent native date input sits over the calendar icon so
// the OS picker is still one tap away for anyone who prefers it; where that
// picker is unavailable, typing carries on.

interface DateFieldProps {
  /** 'YYYY-MM-DD' or '' */
  value: string
  /** Emits a valid 'YYYY-MM-DD', or '' while the entry is empty/incomplete. */
  onChange: (v: string) => void
  id?: string
  required?: boolean
  min?: string
  max?: string
  /** Applied to the text input so the field matches surrounding inputs. */
  className?: string
  'aria-label'?: string
}

export function DateField({
  value, onChange, id, required, min, max, className, ...rest
}: DateFieldProps) {
  const [text, setText] = useState(value)
  const focused = useRef(false)

  // Mirror the controlled value into the visible text — but not while the
  // user is typing, or a partial entry ("1987-0", which we emit upstream as
  // '') would be wiped out from under them. External changes (a form reset,
  // or the native picker) land here.
  useEffect(() => {
    if (!focused.current) setText(value)
  }, [value])

  function handleType(raw: string) {
    const masked = maskYmd(raw)
    setText(masked)
    onChange(isValidYmd(masked) ? masked : '')
  }

  // A picked date is an explicit set: mirror it into the visible text right
  // away, since the mirror effect's focus guard would otherwise hold the
  // display stale until the field loses focus.
  function handlePick(picked: string) {
    onChange(picked)
    setText(picked)
  }

  return (
    <div className="relative w-full min-w-0">
      <input
        type="text"
        inputMode="numeric"
        id={id}
        value={text}
        onChange={e => handleType(e.target.value)}
        onFocus={() => { focused.current = true }}
        // Keep whatever was typed on blur. Snapping back to `value` would wipe
        // a half-entered date to blank (incomplete entries emit '' upstream),
        // losing the digits with no hint as to why. The pattern attribute
        // already flags the entry as invalid until it's complete.
        onBlur={() => { focused.current = false }}
        placeholder="YYYY-MM-DD"
        required={required}
        pattern="\d{4}-\d{2}-\d{2}"
        aria-label={rest['aria-label']}
        className={`${className ?? ''} w-full`}
        style={{ paddingRight: '2.25rem' }}
      />
      <span
        aria-hidden="true"
        className="absolute inset-y-0 right-0 flex items-center px-2 text-brand-900/70 pointer-events-none"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="16" y1="2" x2="16" y2="6" />
        </svg>
      </span>
      {/* A real native date input, laid over the calendar icon at zero opacity.
          Tapping the icon taps this, so a mobile browser opens its own picker
          through ordinary behaviour — nothing depends on showPicker(), whose
          support and its activation / visibility rules are uneven across
          mobile. It replaced a throwaway hidden input built on click, which
          never reliably opened a picker on a phone.

          Desktop Chrome opens a picker only from the calendar indicator, not
          from a click anywhere on the field, so ask explicitly there.

          Being a real input also makes it safe inside a wrapping field
          <label>: a label skips its activation behaviour for events targeting
          interactive content within it, so the tap is not re-dispatched onto
          the text input. The <span role="button"> this replaced was not
          interactive content, so it was re-dispatched — focusing the text
          input and burying the picker behind the soft keyboard.

          It stays tabIndex={-1} and is not the label's control (the typeable
          text input is the first labelable descendant) — the picker is a
          pointer convenience, and typing remains the path for keyboards. */}
      <input
        type="date"
        value={isValidYmd(value) ? value : ''}
        onChange={e => handlePick(e.target.value)}
        onClick={e => {
          const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void }
          try { el.showPicker?.() } catch { /* the tap itself opens it */ }
        }}
        min={min}
        max={max}
        tabIndex={-1}
        aria-label={t.a11y.openCalendar}
        className="absolute inset-y-0 right-0 w-9 opacity-0 cursor-pointer"
      />
    </div>
  )
}
