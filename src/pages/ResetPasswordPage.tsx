import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

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
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-bold text-sky-400 text-center mb-2">FunDivers TW</h1>
        <p className="text-slate-400 text-center mb-8 text-sm">Choose a new password</p>

        {done ? (
          <div className="bg-slate-800 rounded-xl p-6 text-center space-y-3">
            <div className="text-5xl">✅</div>
            <h2 className="text-lg font-semibold text-slate-100">Password updated</h2>
            <p className="text-sm text-slate-400">Signing you in…</p>
          </div>
        ) : !ready ? (
          <div className="text-center text-slate-400 text-sm">Verifying reset link…</div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-300 mb-1">New password</label>
              <input
                type="password" required minLength={8}
                value={password} onChange={e => setPassword(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Confirm password</label>
              <input
                type="password" required minLength={8}
                value={confirm} onChange={e => setConfirm(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>
            {err && <p className="text-red-400 text-sm">{err}</p>}
            <button
              type="submit" disabled={busy}
              className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-semibold py-2 rounded-lg transition-colors"
            >
              {busy ? 'Saving…' : 'Set new password'}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-slate-400 mt-6">
          <Link to="/login" className="text-sky-400 hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
