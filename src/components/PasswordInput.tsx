import { forwardRef, useState } from 'react'
import { EyeIcon } from './icons/EyeIcon'
import { EyeOffIcon } from './icons/EyeOffIcon'

// A password <input> with a built-in show/hide eye toggle. Forwards its ref
// and every native input prop, so it drops into both controlled inputs
// (value/onChange) and react-hook-form's `{...register('password')}` spread.
// `type` is owned internally — the toggle flips it between password and text.
type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className = '', ...props }, ref) {
    const [visible, setVisible] = useState(false)
    return (
      <div className="relative">
        <input
          {...props}
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={`${className} pr-10`}
        />
        <button
          type="button"
          // Outside the tab order: the eye is a convenience, not a form field —
          // tabbing should jump straight from the password to the submit button.
          tabIndex={-1}
          onClick={() => setVisible(v => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-brand-900/60 hover:text-brand-900"
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    )
  },
)
