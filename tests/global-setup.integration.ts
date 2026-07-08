import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

// Strip the WIX sync triggers from the local DB before any integration
// test connects. Migrations install them pointing at the live production
// WIX webhook (see supabase/seeds/disable-wix-triggers.sql for the full
// story); without this, `make test` POSTs every test fixture to prod.
//
// `make reset` already runs the same SQL via [db.seed].sql_paths, but a
// fresh `make start` followed by `make test` skips the reset, so we
// belt-and-suspenders here.

export default function setup() {
  const container = `supabase_db_${basename(process.cwd())}`
  const sqlPath = resolve(process.cwd(), 'supabase/seeds/disable-wix-triggers.sql')
  const sql = readFileSync(sqlPath, 'utf-8')

  try {
    execSync(
      `docker exec -i ${container} psql -U postgres -d postgres -v ON_ERROR_STOP=1`,
      { input: sql, stdio: ['pipe', 'pipe', 'pipe'] }
    )
  } catch (err) {
    throw new Error(
      `Could not drop wix_sync triggers from ${container}. Is the local ` +
        'stack up? Try `make start`. Underlying: ' +
        (err as Error).message,
      { cause: err },
    )
  }
}
