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
