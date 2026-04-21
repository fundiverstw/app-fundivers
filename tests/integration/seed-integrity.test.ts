/**
 * Guards against cloud-dump shapes that local gotrue can't scan.
 * gotrue reads auth.users tokens as Go `string` and rejects NULLs with
 * `sql: Scan error ... converting NULL to string is unsupported`, which
 * surfaces to the client as `500: Database error querying schema`.
 *
 * PostgREST doesn't expose the auth schema by default, so this runs psql
 * inside the local db container (same pattern as scripts/verify-sync.sh).
 */
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'

const NON_NULL_TOKEN_COLUMNS = [
  'confirmation_token',
  'email_change',
  'email_change_token_new',
  'email_change_token_current',
  'recovery_token',
  'phone_change',
  'phone_change_token',
  'reauthentication_token',
] as const

describe('auth.users seed integrity', () => {
  it('has no NULL in any gotrue-sensitive token column', () => {
    const whereNullAny = NON_NULL_TOKEN_COLUMNS.map(c => `${c} IS NULL`).join(' OR ')
    const sql = `SELECT id FROM auth.users WHERE ${whereNullAny};`
    const out = execSync(
      `docker exec supabase_db_app-fundivers psql -U postgres -d postgres -tAc ${JSON.stringify(sql)}`,
      { encoding: 'utf-8' }
    ).trim()

    const offenderIds = out ? out.split('\n').filter(Boolean) : []
    if (offenderIds.length > 0) {
      throw new Error(
        `${offenderIds.length} auth.users row(s) have NULL token columns, ` +
          `which will make gotrue fail sign-in with 500. IDs: ${offenderIds.join(', ')}. ` +
          `Run make dump-data against a patched cloud.`
      )
    }
    expect(offenderIds).toEqual([])
  })
})
