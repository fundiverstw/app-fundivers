import { describe, it, expect, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { basename } from 'node:path'
import { adminClient, userClient, createTestUser, deleteTestUser, type TestUser } from './helpers'
import { buildCertLevelResolver, type CertLadderRow } from '../../src/lib/cert-level'
import { canonicalNationality } from '../../src/lib/nationality'

// The same normalization now lives twice: in TypeScript, where the dashboard
// canonicalizes on read, and in SQL, where the migration rewrote the stored
// rows. Two implementations of one rule drift silently — the charts would go on
// saying "AOW" while a later import wrote "Advanced Scuba Diver" back into the
// column. These tests are the thing that stops that, so they run against the
// real functions in the real database rather than a mock of either.

const admin = adminClient()
const created: TestUser[] = []

/** Straight to PostgreSQL, for the states PostgREST cannot reach.
 *  Flattened to one line: psql reads a literal `\n` as a backslash command. */
function sql(statement: string): string {
  const container = `supabase_db_${basename(process.cwd())}`
  const oneLine = statement.replace(/\s+/g, ' ').trim()
  return execSync(
    `docker exec -i ${container} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc ${JSON.stringify(oneLine)}`,
    { encoding: 'utf-8' },
  ).trim()
}

afterAll(async () => {
  for (const u of created) await deleteTestUser(admin, u.id)
})

async function diver(fields: { cert_level?: string | null; nationality?: string | null }): Promise<TestUser> {
  const u = await createTestUser(admin, { role: 'diver' })
  created.push(u)
  const { error } = await admin.from('profiles').update(fields).eq('id', u.id)
  expect(error).toBeNull()
  return u
}

async function profileOf(id: string) {
  const { data, error } = await admin.from('profiles').select('cert_level, nationality').eq('id', id).single()
  expect(error).toBeNull()
  return data!
}

/** The shop's real ladder, which is what the SQL resolves against. */
async function ladder(): Promise<CertLadderRow[]> {
  const { data, error } = await admin.from('cert_levels').select('id, code, name, padi_equivalent_id')
  expect(error).toBeNull()
  return (data ?? []) as CertLadderRow[]
}

// Verbatim from "Active divers by certification", which showed all of these as
// separate bars, plus the two that must survive untouched.
const CERT_INPUTS = [
  'Advanced Open Water', 'Open Water', 'Rescue', 'Divemaster', 'RD', 'Instructor',
  'Scuba Diver', 'Advanced Scuba Diver', 'OW instructor', 'AOW & nitrox', 'OWD',
  'Master Scuba Diver', 'OWSI', 'Master Diver', '3-Star Diver', 'Staff Instructor',
  'OW/Scuba Diver', 'Advance Adventure Diver', 'PE40', 'Deep Sea Wizard',
]

const NATIONALITY_INPUTS = [
  'USA', 'usa', 'U.S.A.', 'United States', 'America', 'American',
  'Taiwan', 'Taiwanese', 'R.O.C.', 'England', 'British', 'Japanese', 'Latveria',
]

describe('the SQL resolvers agree with the app', () => {
  it('reads every reported certification the way src/lib/cert-level.ts does', async () => {
    const resolve = buildCertLevelResolver(await ladder())

    for (const raw of CERT_INPUTS) {
      const { data: sql, error: err } = await admin.rpc('padi_equivalent_of', { p_value: raw })
      expect(err, `padi_equivalent_of(${raw})`).toBeNull()
      // SQL returns null for "leave it alone"; the TS resolver returns the
      // value unchanged. Same decision, expressed to different callers.
      expect(sql ?? raw, `padi_equivalent_of(${raw})`).toBe(resolve(raw))
    }
  })

  it('reads every reported nationality the way src/lib/nationality.ts does', async () => {
    for (const raw of NATIONALITY_INPUTS) {
      const { data: sql, error } = await admin.rpc('canonical_nationality', { p_value: raw })
      expect(error, `canonical_nationality(${raw})`).toBeNull()
      expect(sql ?? raw, `canonical_nationality(${raw})`).toBe(canonicalNationality(raw))
    }
  })
})

describe('normalize_profile_values', () => {
  it('rewrites a messy certification and logs what it replaced', async () => {
    const u = await diver({ cert_level: 'Advanced Scuba Diver' })

    const { data: changed, error } = await admin.rpc('normalize_profile_values')
    expect(error).toBeNull()
    expect(changed).toBeGreaterThan(0)

    expect((await profileOf(u.id)).cert_level).toBe('AOW')

    const { data: log } = await admin
      .from('profile_value_normalizations')
      .select('field, old_value, new_value')
      .eq('profile_id', u.id)
    expect(log).toEqual([{ field: 'cert_level', old_value: 'Advanced Scuba Diver', new_value: 'AOW' }])
  })

  it('collapses several spellings of one country onto one value', async () => {
    const divers = await Promise.all(
      ['USA', 'United States', 'American'].map(nationality => diver({ nationality })),
    )
    await admin.rpc('normalize_profile_values')

    for (const u of divers) {
      expect((await profileOf(u.id)).nationality).toBe('United States')
    }
  })

  // Writing a rung a diver never earned is worse than leaving an untidy label,
  // and the untidy label is what tells an admin to go and ask them.
  it('leaves a certification the ladder cannot place exactly as it was', async () => {
    const u = await diver({ cert_level: 'PE40', nationality: 'Latveria' })
    await admin.rpc('normalize_profile_values')

    expect(await profileOf(u.id)).toEqual({ cert_level: 'PE40', nationality: 'Latveria' })

    const { data: log } = await admin
      .from('profile_value_normalizations')
      .select('id')
      .eq('profile_id', u.id)
    expect(log).toEqual([])
  })

  // `profiles_maybe_set_submitted_at_trg` stamps the application date the first
  // time a profile looks complete, and fires on any update. Correcting the
  // spelling of a certification is not an application, and recording it as one
  // would move the date and — where the approvals queue gates on that column —
  // drop the diver into it.
  //
  // The state this guards is one the app itself cannot produce: a complete
  // profile with no application date, which is what a direct legacy import
  // leaves behind (the trigger is BEFORE UPDATE, so an INSERT never stamps).
  // Reproducing it needs the same trigger held off, so this reaches past
  // PostgREST the way backup-table-inventory.test.ts does.
  it('does not stamp an application date onto the profiles it rewrites', async () => {
    const u = await diver({})
    sql(`
      alter table public.profiles disable trigger profiles_maybe_set_submitted_at_trg;
      update public.profiles set
        name = 'Legacy Import', date_of_birth = '1990-01-01',
        cert_level = 'Advanced Scuba Diver', contact_method = 'line',
        contact_id = 'legacy', application_submitted_at = null
        where id = '${u.id}';
      alter table public.profiles enable trigger profiles_maybe_set_submitted_at_trg;
    `)
    expect(sql(`select coalesce(application_submitted_at::text, 'NULL') from public.profiles where id = '${u.id}'`))
      .toBe('NULL')

    const { data: changed, error } = await admin.rpc('normalize_profile_values')
    expect(error).toBeNull()
    expect(changed).toBeGreaterThan(0)

    const after = await profileOf(u.id)
    expect(after.cert_level).toBe('AOW')
    expect(sql(`select coalesce(application_submitted_at::text, 'NULL') from public.profiles where id = '${u.id}'`))
      .toBe('NULL')
  })

  // Held off for the pass, and put back. Leaving it disabled would mean no
  // diver who completed their profile afterwards was ever recorded as having
  // applied — a silent failure nobody would notice for weeks.
  it('leaves the completeness trigger enabled afterwards', async () => {
    await admin.rpc('normalize_profile_values')
    expect(sql(`
      select tgenabled from pg_trigger
       where tgrelid = 'public.profiles'::regclass
         and tgname = 'profiles_maybe_set_submitted_at_trg'
    `)).toBe('O')
  })

  it('writes nothing on a second run', async () => {
    await diver({ cert_level: 'Master Diver', nationality: 'Taiwanese' })
    await admin.rpc('normalize_profile_values')

    const { data: second, error } = await admin.rpc('normalize_profile_values')
    expect(error).toBeNull()
    expect(second).toBe(0)
  })

  // It rewrites other people's profiles, so it is service-role only. An
  // ordinary signed-in diver must not be able to reach it.
  it('is not callable by a signed-in diver', async () => {
    const u = await diver({})
    const asDiver = await userClient(u.email, u.password)
    const { error } = await asDiver.rpc('normalize_profile_values')
    expect(error).not.toBeNull()
  })
})
