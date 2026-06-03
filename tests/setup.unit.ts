import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Vite env defaults so `import.meta.env.*` reads are defined in tests.
// Individual tests can override with vi.stubEnv(...).
vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:64321')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')

// Stub the Cloudflare Turnstile widget: every render synchronously
// "completes" with a fake token so RegisterForm's guest-path step
// gates pass in tests. The handler unit suite separately covers the
// real verify-token contract (handler.test.ts).
vi.mock('../src/components/register/TurnstileWidget', () => ({
  TurnstileWidget: ({ onToken }: { onToken: (t: string | null) => void }) => {
    onToken('test-turnstile-token')
    return null
  },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
