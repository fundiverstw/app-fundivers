import { useEffect, useRef, useState } from 'react'
import { maskYmd, isValidYmd } from '../lib/date-input'

// A date input that can always be TYPED, not just picked from a calendar.
//
// Native <input type="date"> on some Android browsers only opens a
// calendar that scrolls one month at a time — miserable for picking a
// birth year decades back. This component keeps the value contract of the
// native input (a 'YYYY-MM-DD' string, or '' when empty/incomplete) but the
// primary control is a free-text field that auto-masks digits into
// YYYY-MM-DD. A calendar button still opens the OS picker (via showPicker)
// for anyone who prefers it; where that's unsupported, typing carries on.

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
  const btnRef = useRef<HTMLSpanElement>(null)

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

  // Open the OS date picker via a throwaway native <input type="date">.
  // Building it on demand (rather than keeping a hidden one mounted) keeps
  // the rendered field to a single input — no phantom duplicate for the DOM
  // or tests. showPicker() carries a user gesture from the click; where it's
  // unsupported, typing remains the path.
  function openPicker() {
    const native = document.createElement('input')
    native.type = 'date'
    if (value) native.value = value
    if (min) native.min = min
    if (max) native.max = max
    // Anchor it at the button so a desktop picker pops up in the right place;
    // on mobile the picker is a modal, so position is irrelevant.
    const rect = btnRef.current?.getBoundingClientRect()
    Object.assign(native.style, {
      position: 'fixed',
      top: `${rect?.bottom ?? 0}px`,
      left: `${rect?.left ?? 0}px`,
      width: '1px', height: '1px', opacity: '0', pointerEvents: 'none', zIndex: '-1',
    })
    document.body.appendChild(native)
    const cleanup = () => native.remove()
    native.addEventListener('change', () => { onChange(native.value); cleanup() })
    native.addEventListener('cancel', cleanup)
    native.addEventListener('blur', () => setTimeout(cleanup, 100))
    try { native.showPicker() } catch { cleanup() }
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
        onBlur={() => { focused.current = false; setText(value) }}
        placeholder="YYYY-MM-DD"
        required={required}
        pattern="\d{4}-\d{2}-\d{2}"
        aria-label={rest['aria-label']}
        className={`${className ?? ''} w-full`}
        style={{ paddingRight: '2.25rem' }}
      />
      {/* A non-labelable <span> (not <button>) so a wrapping field <label>
          doesn't also associate with it — the typeable text input stays the
          one labelled control. The picker is a touch/mouse convenience. */}
      <span
        ref={btnRef}
        role="button"
        onClick={openPicker}
        aria-label="Open calendar"
        className="absolute inset-y-0 right-0 flex items-center px-2 text-brand-900/70 hover:text-brand-900 cursor-pointer"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="16" y1="2" x2="16" y2="6" />
        </svg>
      </span>
    </div>
  )
}
