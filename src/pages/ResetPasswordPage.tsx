import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, authCallbackParams } from '../lib/supabase'
import { Logo } from '../components/Logo'
import { CARD_ELEVATED, INPUT, INPUT_LABEL, BTN_PRIMARY, TEXT_ERROR, TEXT_LINK, TEXT_MUTED, TEXT_HEADING } from '../styles/tokens'

const LINK_ERROR =
  'This reset link is invalid or has expired — links can only be used once, and some email providers open them automatically. Request a fresh one and use it right away.'

// Public landing page for the reset-password email link. Supabase's recovery
// URL drops the diver here and, on a same-browser PKCE exchange, fires a
// PASSWORD_RECOVERY auth event; we capture a new password and call updateUser.
// When the link is expired / already consumed / opened on a different device,
// no recovery session is established — we surface an actionable error instead
// of hanging on "Verifying…".
export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)   // recovery session present?
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  // GoTrue reports a dead link as ?error=...&error_code=otp_expired on the URL.
  const [linkError, setLinkError] = useState(authCallbackParams.error ? LINK_ERROR : '')

  useEffect(() => {
    if (linkError) return
    let active = true
    let recovered = false

    // Audit M9 — only a fresh recovery link may unlock the form, never a
    // pre-existing login. The PASSWORD_RECOVERY event is that proof.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') { recovered = true; setReady(true) }
    })

    // Fallback for when PASSWORD_RECOVERY is emitted during client init (URL
    // processing) before this listener attaches. getSession() resolves only
    // after init, so the code exchange has settled by then. We still honour
    // M9: unlock only when a recovery `code` was actually present in the URL
    // and produced a session — a bare session (ordinary login) does not.
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (!active || recovered) return
      if (authCallbackParams.code && data.session) setReady(true)
      else setLinkError(LINK_ERROR)
    })()

    return () => { active = false; sub.subscription.unsubscribe() }
  }, [linkError])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (password.length < 8) { setErr('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setErr('Passwords do not match.'); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setDone(true)
    setTimeout(() => navigate('/calendar'), 1200)
  }

  return (
    <div className="min-h-screen bg-blue-900 flex items-center justify-center p-4">
      <div className={`w-full max-w-sm ${CARD_ELEVATED} p-6`}>
        <div className="flex justify-center mb-3"><Logo size="lg" /></div>
        <p className={`${TEXT_MUTED} text-center mb-8 text-sm`}>Choose a new password</p>

        {done ? (
          <div className="text-center space-y-3">
            <div className="text-5xl">✅</div>
            <h2 className={`text-lg font-semibold ${TEXT_HEADING}`}>Password updated</h2>
            <p className={`text-sm ${TEXT_MUTED}`}>Signing you in…</p>
          </div>
        ) : linkError ? (
          <div className="text-center space-y-4">
            <h2 className={`text-lg font-semibold ${TEXT_HEADING}`}>Link expired</h2>
            <p className={`text-sm ${TEXT_ERROR}`}>{linkError}</p>
            <Link to="/forgot-password" className={`inline-block w-full ${BTN_PRIMARY}`}>
              Request a new link
            </Link>
          </div>
        ) : !ready ? (
          <div className={`text-center ${TEXT_MUTED} text-sm`}>Verifying reset link…</div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className={INPUT_LABEL}>New password</label>
              <input
                type="password" name="password" required minLength={8}
                value={password} onChange={e => setPassword(e.target.value)}
                className={INPUT}
              />
            </div>
            <div>
              <label className={INPUT_LABEL}>Confirm password</label>
              <input
                type="password" name="confirm" required minLength={8}
                value={confirm} onChange={e => setConfirm(e.target.value)}
                className={INPUT}
              />
            </div>
            {err && <p className={`${TEXT_ERROR} text-sm`}>{err}</p>}
            <button type="submit" disabled={busy} className={`w-full ${BTN_PRIMARY}`}>
              {busy ? 'Saving…' : 'Set new password'}
            </button>
          </form>
        )}

        <p className={`text-center text-sm ${TEXT_MUTED} mt-6`}>
          <Link to="/login" className={TEXT_LINK}>Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
