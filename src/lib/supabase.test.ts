import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('supabase client module', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws when VITE_SUPABASE_URL is missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')
    await expect(import('./supabase')).rejects.toThrow(/Missing.*VITE_SUPABASE_URL/i)
  })

  it('throws when VITE_SUPABASE_ANON_KEY is missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:64321')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    await expect(import('./supabase')).rejects.toThrow(/Missing.*VITE_SUPABASE_ANON_KEY/i)
  })

  it('exports a supabase client when both env vars are present', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:64321')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')
    const mod = await import('./supabase')
    expect(mod.supabase).toBeDefined()
    expect(typeof mod.supabase.from).toBe('function')
    expect(typeof mod.supabase.auth.getSession).toBe('function')
  })
})
