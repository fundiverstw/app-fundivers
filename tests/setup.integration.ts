import { execSync } from 'node:child_process'

// Populate env from `supabase status -o env` so tests get fresh local keys
// (anon + service_role) without needing them committed anywhere.
try {
  const out = execSync('npx supabase status -o env', {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const line of out.split('\n')) {
    const m = line.match(/^([A-Z_]+)="?([^"\n]*?)"?$/)
    if (m) process.env[m[1]] = m[2]
  }
} catch (err) {
  throw new Error(
    'Could not run `supabase status`. Is the local stack up? Try `make start`. ' +
      'Underlying: ' +
      (err as Error).message,
    { cause: err },
  )
}

if (!process.env.API_URL || !process.env.SERVICE_ROLE_KEY) {
  throw new Error(
    'supabase status did not expose API_URL and SERVICE_ROLE_KEY. Is the stack running?'
  )
}

// Point the APP's module-level client (src/lib/supabase.ts, which reads
// import.meta.env.VITE_*) at the same local stack. Without this it picks up
// `.env`'s VITE_SUPABASE_ANON_KEY=dummy-anon-key-for-build — a placeholder that
// exists only to satisfy the build-time required-env check. Every read through
// that client then fails auth, the lib helpers swallow the error and return [],
// and the tests that exercise src/lib/* fail with a baffling
// "expected false to be true". Two of them did, silently, for a while.
const viteEnv = import.meta.env as unknown as Record<string, string>
viteEnv.VITE_SUPABASE_URL = process.env.API_URL
viteEnv.VITE_SUPABASE_ANON_KEY = process.env.ANON_KEY!
