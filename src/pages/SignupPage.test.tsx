import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SignupPage } from './SignupPage'
import { renderWithRouter, byName } from '../../tests/test-utils'
import { t } from '../i18n'

const { invokeWithRetry, setSession, signInWithPassword } = vi.hoisted(() => ({
  invokeWithRetry:    vi.fn(),
  setSession:         vi.fn(),
  signInWithPassword: vi.fn(),
}))

vi.mock('../lib/edge-invoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/edge-invoke')>()),
  invokeWithRetry,
}))

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { setSession, signInWithPassword } },
}))

vi.mock('../lib/use-terms', () => ({
  useTerms: () => ({ terms: { title: 'T', body: '', version: 4 }, loading: false }),
}))

// Stand-in for the Turnstile challenge: a button the test can "solve", the
// same shape RegisterForm's suite uses.
vi.mock('../components/register/TurnstileWidget', () => ({
  TurnstileWidget: ({ onToken, onUnavailable }: {
    onToken: (t: string) => void
    onUnavailable?: () => void
  }) => (
    <>
      <button type="button" onClick={() => onToken('test-turnstile-token')}>solve captcha</button>
      <button type="button" onClick={() => onUnavailable?.()}>break captcha</button>
    </>
  ),
}))

beforeEach(() => {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-site-key')
  invokeWithRetry.mockReset()
  setSession.mockReset()
  signInWithPassword.mockReset()
  invokeWithRetry.mockResolvedValue({ data: { ok: true, user_id: 'u1', session: { access_token: 'a', refresh_token: 'r' } }, error: null })
})

function renderWithCalendar() {
  return render(
    <MemoryRouter initialEntries={['/signup']}>
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/calendar" element={<div>CALENDAR_PAGE</div>} />
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
      </Routes>
    </MemoryRouter>
  )
}

async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(byName('name'), 'Ada Lovelace')
  await user.type(byName('email'), 'ada@example.com')
  await user.type(byName('password'), 'secret1234')
  await user.click(byName('agreedToTerms'))
  await user.click(screen.getByRole('button', { name: /solve captcha/i }))
}

/** An edge-function rejection in the shape supabase-js actually produces. */
function httpError(status: number, body: Record<string, unknown>) {
  const error = new Error('Edge Function returned a non-2xx status code') as Error & { context?: unknown }
  error.name = 'FunctionsHttpError'
  error.context = { status, json: async () => body }
  return { data: null, error }
}

describe('SignupPage', () => {
  it('asks for a name, an email and a password, and nothing else', () => {
    renderWithRouter(<SignupPage />)
    const fields = [...document.querySelectorAll('input')].map(el => el.getAttribute('name'))
    expect(fields).toEqual(['name', 'email', 'password', 'agreedToTerms'])
  })

  it('says the name is the one on the passport', () => {
    renderWithRouter(<SignupPage />)
    expect(screen.getByLabelText(t.auth.nameLabel)).toBeInTheDocument()
    expect(screen.getByText(t.auth.nameHint)).toBeInTheDocument()
  })

  // The complaint this redesign answers: the old flow demanded a full profile
  // before a diver could see anything.
  it('promises the rest of the profile can wait', () => {
    renderWithRouter(<SignupPage />)
    expect(screen.getByText(t.auth.profileLater)).toBeInTheDocument()
  })

  it('rejects an empty submit', async () => {
    const user = userEvent.setup()
    renderWithRouter(<SignupPage />)
    await user.click(screen.getByRole('button', { name: /solve captcha/i }))
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(t.auth.nameRequired)).toBeInTheDocument()
    expect(screen.getByText(/invalid email/i)).toBeInTheDocument()
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument()
    expect(invokeWithRetry).not.toHaveBeenCalled()
  })

  it('rejects a too-short password', async () => {
    const user = userEvent.setup()
    renderWithRouter(<SignupPage />)
    await user.type(byName('name'), 'Ada')
    await user.type(byName('email'), 'ada@example.com')
    await user.type(byName('password'), 'short')
    await user.click(screen.getByRole('button', { name: /solve captcha/i }))
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument()
    expect(invokeWithRetry).not.toHaveBeenCalled()
  })

  it('rejects a submit without the terms checkbox', async () => {
    const user = userEvent.setup()
    renderWithRouter(<SignupPage />)
    await user.type(byName('name'), 'Ada')
    await user.type(byName('email'), 'ada@example.com')
    await user.type(byName('password'), 'secret1234')
    await user.click(screen.getByRole('button', { name: /solve captcha/i }))
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/please agree to continue/i)).toBeInTheDocument()
    expect(invokeWithRetry).not.toHaveBeenCalled()
  })

  // Submitting without a token would be rejected server-side every time, so
  // the button stays disabled until the challenge resolves.
  it('will not submit until the captcha is solved', async () => {
    const user = userEvent.setup()
    renderWithRouter(<SignupPage />)
    await user.type(byName('name'), 'Ada')
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /solve captcha/i }))
    expect(screen.getByRole('button', { name: /create account/i })).toBeEnabled()
  })

  it('sends the name, credentials, consent and captcha token, then lands on the calendar', async () => {
    const user = userEvent.setup()
    renderWithCalendar()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(invokeWithRetry).toHaveBeenCalledOnce())
    const [fn, opts] = invokeWithRetry.mock.calls[0]
    expect(fn).toBe('create-account')
    expect(opts.body.name).toBe('Ada Lovelace')
    expect(opts.body.email).toBe('ada@example.com')
    expect(opts.body.password).toBe('secret1234')
    expect(opts.body.turnstile_token).toBe('test-turnstile-token')
    expect(typeof opts.body.agreed_to_terms_at).toBe('string')
    expect(opts.body.agreed_to_terms_version).toBe(4)

    // No approval queue and no confirmation email between here and the app.
    expect(await screen.findByText('CALENDAR_PAGE')).toBeInTheDocument()
    expect(setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' })
  })

  it('lowercases and trims the email it sends', async () => {
    const user = userEvent.setup()
    renderWithCalendar()
    await user.type(byName('name'), 'Ada')
    await user.type(byName('email'), '  Ada@Example.COM  ')
    await user.type(byName('password'), 'secret1234')
    await user.click(byName('agreedToTerms'))
    await user.click(screen.getByRole('button', { name: /solve captcha/i }))
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(invokeWithRetry).toHaveBeenCalledOnce())
    expect(invokeWithRetry.mock.calls[0][1].body.email).toBe('ada@example.com')
  })

  // The account exists and the password is the one they just chose, so a
  // failed courtesy sign-in must not be reported as a failed signup.
  it('signs in itself when the function returns no session', async () => {
    invokeWithRetry.mockResolvedValue({ data: { ok: true, user_id: 'u1', session: null }, error: null })
    signInWithPassword.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderWithCalendar()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText('CALENDAR_PAGE')).toBeInTheDocument()
    expect(signInWithPassword).toHaveBeenCalledOnce()
  })

  it('falls back to the login page when it cannot sign in either', async () => {
    invokeWithRetry.mockResolvedValue({ data: { ok: true, user_id: 'u1', session: null }, error: null })
    signInWithPassword.mockResolvedValue({ error: { message: 'nope' } })
    const user = userEvent.setup()
    renderWithCalendar()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText('LOGIN_PAGE')).toBeInTheDocument()
  })
})

// Every one of these used to surface as either the raw Postgres/GoTrue string
// or supabase-js's "Edge Function returned a non-2xx status code" — the
// "throws errors" complaint in as many words.
describe('SignupPage error messages', () => {
  it('offers a way to sign in when the email is already taken', async () => {
    invokeWithRetry.mockResolvedValue(httpError(409, { error: 'email already registered', code: 'email_exists' }))
    const user = userEvent.setup()
    renderWithCalendar()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(t.auth.emailTaken)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t.auth.emailTakenAction }))
      .toHaveAttribute('href', '/login')
    expect(screen.queryByText('CALENDAR_PAGE')).not.toBeInTheDocument()
  })

  it('explains a rate-limit rejection in plain words', async () => {
    invokeWithRetry.mockResolvedValue(httpError(429, { error: 'too many signup attempts, try again later' }))
    const user = userEvent.setup()
    renderWithCalendar()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(t.auth.tooManyAttempts)).toBeInTheDocument()
  })

  it('names the connection when the request never reached the server', async () => {
    const error = new Error('Failed to send a request to the Edge Function') as Error & { context?: unknown }
    error.name = 'FunctionsFetchError'
    invokeWithRetry.mockResolvedValue({ data: null, error })
    const user = userEvent.setup()
    renderWithCalendar()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(t.auth.offline)).toBeInTheDocument()
  })

  it('translates a captcha rejection instead of echoing the wire string', async () => {
    invokeWithRetry.mockResolvedValue(httpError(403, { error: 'captcha verification failed' }))
    const user = userEvent.setup()
    renderWithCalendar()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(t.auth.captchaFailed)).toBeInTheDocument()
    expect(screen.queryByText(/captcha verification failed/i)).not.toBeInTheDocument()
  })

  it('never shows the raw edge-function status string for an unrecognized failure', async () => {
    invokeWithRetry.mockResolvedValue(httpError(500, { error: 'rate-limit check failed' }))
    const user = userEvent.setup()
    renderWithCalendar()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(t.auth.signupFailed)).toBeInTheDocument()
    expect(screen.queryByText(/non-2xx/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/rate-limit check failed/i)).not.toBeInTheDocument()
  })

  // A Turnstile token is single-use, so a retry needs a fresh challenge.
  it('clears the solved captcha after a failure', async () => {
    invokeWithRetry.mockResolvedValue(httpError(400, { error: 'nope' }))
    const user = userEvent.setup()
    renderWithCalendar()
    await fillIn(user)
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await screen.findByText(t.auth.signupFailed)
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled()
  })
})

// The worst version of "signup is broken": a filled-in form behind a button
// that can never enable, with nothing on screen saying why.
describe('SignupPage when the captcha script cannot load', () => {
  it('swaps in the contact-us copy instead of leaving a dead button', async () => {
    const user = userEvent.setup()
    renderWithRouter(<SignupPage />)
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /break captcha/i }))

    expect(screen.getByText(t.auth.captchaUnavailable)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument()
  })

  it('still offers the way to sign in', async () => {
    const user = userEvent.setup()
    renderWithRouter(<SignupPage />)
    await user.click(screen.getByRole('button', { name: /break captcha/i }))
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login')
  })
})

describe('SignupPage without a Turnstile site key', () => {
  it('says so up front instead of letting the form fail on submit', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    renderWithRouter(<SignupPage />)
    expect(screen.getByText(t.auth.captchaUnavailable)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument()
  })

  it('still offers the way to sign in', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    renderWithRouter(<SignupPage />)
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login')
  })
})
