import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Logo } from '../components/Logo'
import { CARD_ELEVATED, INPUT, INPUT_LABEL, BTN_PRIMARY, TEXT_ERROR, TEXT_LINK, TEXT_MUTED, TEXT_HEADING } from '../styles/tokens'

// Public landing page for the reset-password email link.
// Supabase's recovery URL drops the diver here with a recovery-scoped
// session already attached (PASSWORD_RECOVERY auth event); we just need
// to capture a new password and call updateUser.
export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)   // session present?
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    // The recovery link sets up a session asynchronously after the page
    // loads; wait for either an existing session or the PASSWORD_RECOVERY
    // event before letting the form submit.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

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
        ) : !ready ? (
          <div className={`text-center ${TEXT_MUTED} text-sm`}>Verifying reset link…</div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className={INPUT_LABEL}>New password</label>
              <input
                type="password" required minLength={8}
                value={password} onChange={e => setPassword(e.target.value)}
                className={INPUT}
              />
            </div>
            <div>
              <label className={INPUT_LABEL}>Confirm password</label>
              <input
                type="password" required minLength={8}
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
