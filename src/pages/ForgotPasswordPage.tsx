import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Logo } from '../components/Logo'
import { CARD_ELEVATED, INPUT, INPUT_LABEL, BTN_PRIMARY, TEXT_ERROR, TEXT_LINK, TEXT_MUTED, TEXT_HEADING } from '../styles/tokens'

// Public page: diver enters their email, we ask Supabase to mail a
// recovery link that returns to /reset-password (the URL must be on the
// project's redirect allowlist — same one /register/** uses).
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setSent(true)
  }

  return (
    <div className="min-h-screen bg-brand-900 flex items-center justify-center p-4">
      <div className={`w-full max-w-sm ${CARD_ELEVATED} p-6`}>
        <div className="flex justify-center mb-3"><Logo size="lg" /></div>
        <p className={`${TEXT_MUTED} text-center mb-8 text-sm`}>Reset your password</p>

        {sent ? (
          <div className="text-center space-y-3">
            <div className="text-5xl">📧</div>
            <h2 className={`text-lg font-semibold ${TEXT_HEADING}`}>Check your email</h2>
            <p className={`text-sm ${TEXT_MUTED}`}>
              If an account exists for <strong>{email}</strong>, a reset link is on its way.
              Click it to set a new password.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className={INPUT_LABEL}>Email</label>
              <input
                type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className={INPUT}
              />
            </div>
            {err && <p className={`${TEXT_ERROR} text-sm`}>{err}</p>}
            <button type="submit" disabled={busy} className={`w-full ${BTN_PRIMARY}`}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <p className={`text-center text-sm ${TEXT_MUTED} mt-6`}>
          Remembered it?{' '}
          <Link to="/login" className={TEXT_LINK}>Sign in</Link>
        </p>
      </div>
    </div>
  )
}
