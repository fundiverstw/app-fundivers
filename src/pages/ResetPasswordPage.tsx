import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, authCallbackParams } from '../lib/supabase'
import { Logo } from '../components/Logo'
import { PasswordInput } from '../components/PasswordInput'
import { CARD_ELEVATED, INPUT, INPUT_LABEL, BTN_PRIMARY, TEXT_ERROR, TEXT_LINK, TEXT_MUTED, TEXT_HEADING } from '../styles/tokens'
import { t } from '../i18n'

const LINK_ERROR = t.auth.linkError

// Public landing page for the reset-password email link. Two arrival shapes:
//   - token_hash + type=recovery → we verifyOtp() it here. Preferred: the link
//     points at this app, so a mail scanner pre-fetching it can't burn the
//     one-time token, and it needs no PKCE verifier (works cross-device).
//   - ?code= (legacy PKCE) → detectSessionInUrl exchanges it during client
//     init and fires PASSWORD_RECOVERY; kept as a fallback for links already
//     in flight before the email template switched to token_hash.
// Either way we only unlock for a *fresh* recovery link (audit M9), never a
// pre-existing login, and surface an actionable error instead of hanging when
// the link is expired / consumed / opened on a different device.
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
  const verifyStarted = useRef(false)

  useEffect(() => {
    if (linkError) return

    // Preferred path: exchange the token_hash via verifyOtp. Ref-guarded so a
    // StrictMode double-mount can't fire it twice and burn the token itself.
    if (authCallbackParams.tokenHash && authCallbackParams.type === 'recovery') {
      if (verifyStarted.current) return
      verifyStarted.current = true
      supabase.auth
        .verifyOtp({ type: 'recovery', token_hash: authCallbackParams.tokenHash })
        .then(({ data, error }) => {
          // Drop the (now consumed) token_hash from the address bar + history,
          // matching the cleanup detectSessionInUrl does for the ?code= path.
          window.history.replaceState({}, '', window.location.pathname)
          if (error || !data?.session) setLinkError(LINK_ERROR)
          else setReady(true)
        })
      return
    }

    let active = true
    let recovered = false

    // Legacy ?code= path. Audit M9 — only a fresh recovery link may unlock the
    // form, never a pre-existing login; the PASSWORD_RECOVERY event is proof.
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
    if (password.length < 8) { setErr(t.auth.passwordMinDot); return }
    if (password !== confirm) { setErr(t.auth.passwordsNoMatchDot); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setDone(true)
    setTimeout(() => navigate('/calendar'), 1200)
  }

  return (
    <div className="min-h-screen bg-brand-900 flex items-center justify-center p-4">
      <div className={`w-full max-w-sm ${CARD_ELEVATED} p-6`}>
        <div className="flex justify-center mb-3"><Logo size="lg" /></div>
        <p className={`${TEXT_MUTED} text-center mb-8 text-sm`}>{t.auth.choosePrompt}</p>

        {done ? (
          <div className="text-center space-y-3">
            <div className="text-5xl">✅</div>
            <h2 className={`text-lg font-semibold ${TEXT_HEADING}`}>{t.auth.passwordUpdated}</h2>
            <p className={`text-sm ${TEXT_MUTED}`}>{t.auth.signingYouIn}</p>
          </div>
        ) : linkError ? (
          <div className="text-center space-y-4">
            <h2 className={`text-lg font-semibold ${TEXT_HEADING}`}>{t.auth.linkExpired}</h2>
            <p className={`text-sm ${TEXT_ERROR}`}>{linkError}</p>
            <Link to="/forgot-password" className={`inline-block w-full ${BTN_PRIMARY}`}>
              {t.auth.requestNewLink}
            </Link>
          </div>
        ) : !ready ? (
          <div className={`text-center ${TEXT_MUTED} text-sm`}>{t.auth.verifying}</div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className={INPUT_LABEL}>{t.auth.newPassword}</label>
              <PasswordInput
                name="password" required minLength={8}
                value={password} onChange={e => setPassword(e.target.value)}
                className={INPUT}
              />
            </div>
            <div>
              <label className={INPUT_LABEL}>{t.auth.confirmPassword}</label>
              <PasswordInput
                name="confirm" required minLength={8}
                value={confirm} onChange={e => setConfirm(e.target.value)}
                className={INPUT}
              />
            </div>
            {err && <p className={`${TEXT_ERROR} text-sm`}>{err}</p>}
            <button type="submit" disabled={busy} className={`w-full ${BTN_PRIMARY}`}>
              {busy ? t.auth.saving : t.auth.setNewPassword}
            </button>
          </form>
        )}

        <p className={`text-center text-sm ${TEXT_MUTED} mt-6`}>
          <Link to="/login" className={TEXT_LINK}>{t.auth.backToSignIn}</Link>
        </p>
      </div>
    </div>
  )
}
