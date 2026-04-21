import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Vite env defaults so `import.meta.env.*` reads are defined in tests.
// Individual tests can override with vi.stubEnv(...).
vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:64321')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
