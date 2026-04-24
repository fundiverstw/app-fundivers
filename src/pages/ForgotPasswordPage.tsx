import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

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
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-bold text-sky-400 text-center mb-2">FunDivers TW</h1>
        <p className="text-slate-400 text-center mb-8 text-sm">Reset your password</p>

        {sent ? (
          <div className="bg-slate-800 rounded-xl p-6 text-center space-y-3">
            <div className="text-5xl">📧</div>
            <h2 className="text-lg font-semibold text-slate-100">Check your email</h2>
            <p className="text-sm text-slate-400">
              If an account exists for <strong>{email}</strong>, a reset link is on its way.
              Click it to set a new password.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Email</label>
              <input
                type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>
            {err && <p className="text-red-400 text-sm">{err}</p>}
            <button
              type="submit" disabled={busy}
              className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-semibold py-2 rounded-lg transition-colors"
            >
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-slate-400 mt-6">
          Remembered it?{' '}
          <Link to="/login" className="text-sky-400 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
