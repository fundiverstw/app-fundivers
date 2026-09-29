import { describe, it, expect, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { basename } from 'node:path'
import { adminClient, createTestUser, deleteTestUser, type TestUser } from './helpers'

// profiles.cert_level_code is the diver's certification; cert_agency /
// cert_level are a copy the database writes from it. These run against the real
// triggers and backfill, because the whole point is that no client can make the
// two disagree.

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

async function diver(): Promise<TestUser> {
  const u = await createTestUser(admin, { role: 'diver' })
  created.push(u)
  return u
}

async function cert(id: string) {
  const { data, error } = await admin
    .from('profiles')
    .select('cert_agency, cert_level, cert_level_code, uncertified')
    .eq('id', id)
    .single()
  expect(error).toBeNull()
  return data!
}

/** Plant a legacy free-text certification with no code, the shape the
 *  backfill finds in production. */
async function legacy(id: string, agency: string | null, level: string) {
  const { error } = await admin.from('profiles')
    .update({ cert_agency: agency, cert_level: level, cert_level_code: null })
    .eq('id', id)
  expect(error).toBeNull()
}

describe('the text copy follows the code', () => {
  it('writes the picked row’s agency and name', async () => {
    const u = await diver()
    const { error } = await admin.from('profiles').update({ cert_level_code: 'sdi_rescue' }).eq('id', u.id)
    expect(error).toBeNull()
    expect(await cert(u.id)).toMatchObject({ cert_agency: 'SDI', cert_level: 'Rescue Diver', cert_level_code: 'sdi_rescue' })
  })

  it('overrules text written alongside a code', async () => {
    const u = await diver()
    await admin.from('profiles')
      .update({ cert_level_code: 'open_water', cert_agency: 'SSI', cert_level: 'Divemaster' })
      .eq('id', u.id)
    expect(await cert(u.id)).toMatchObject({ cert_agency: 'PADI', cert_level: 'OW' })
  })

  it('clears the text when the code is cleared', async () => {
    const u = await diver()
    await admin.from('profiles').update({ cert_level_code: 'open_water' }).eq('id', u.id)
    await admin.from('profiles').update({ cert_level_code: null }).eq('id', u.id)
    expect(await cert(u.id)).toMatchObject({ cert_agency: null, cert_level: null })
  })

  it('clears legacy text when the diver says they are uncertified', async () => {
    const u = await diver()
    await legacy(u.id, 'PSAI', 'PE40')
    await admin.from('profiles').update({ uncertified: true }).eq('id', u.id)
    expect(await cert(u.id)).toMatchObject({ cert_agency: null, cert_level: null, cert_level_code: null })
  })

  it('leaves unplaced legacy text alone on an unrelated edit', async () => {
    const u = await diver()
    await legacy(u.id, 'PSAI', 'PE40')
    await admin.from('profiles').update({ logged_dives: 30 }).eq('id', u.id)
    expect(await cert(u.id)).toMatchObject({ cert_agency: 'PSAI', cert_level: 'PE40', cert_level_code: null })
  })

  it('follows an admin renaming the level', async () => {
    const u = await diver()
    await admin.from('profiles').update({ cert_level_code: 'ssi_dive_con' }).eq('id', u.id)
    sql(`update public.cert_levels set name = 'Dive Con (renamed)' where code = 'ssi_dive_con'`)
    try {
      expect((await cert(u.id)).cert_level).toBe('Dive Con (renamed)')
    } finally {
      sql(`update public.cert_levels set name = 'Dive Con' where code = 'ssi_dive_con'`)
    }
    expect((await cert(u.id)).cert_level).toBe('Dive Con')
  })
})

describe('what the column refuses', () => {
  it('a code that is not on the ladder', async () => {
    const u = await diver()
    const { error } = await admin.from('profiles').update({ cert_level_code: 'advanced' }).eq('id', u.id)
    expect(error?.code).toBe('23503')
  })

  it('a level on an uncertified profile', async () => {
    const u = await diver()
    const { error } = await admin.from('profiles')
      .update({ cert_level_code: 'open_water', uncertified: true })
      .eq('id', u.id)
    expect(error?.code).toBe('23514')
  })

  it('deleting a level a diver holds', async () => {
    const u = await diver()
    await admin.from('profiles').update({ cert_level_code: 'cmas_3_star_diver' }).eq('id', u.id)
    expect(() => sql(`delete from public.cert_levels where code = 'cmas_3_star_diver'`)).toThrow(/foreign key/)
  })
})

describe('backfill_profile_cert_level_codes', () => {
  it('places legacy text on the agency’s own level, and leaves what it cannot place', async () => {
    const cases: Array<[string | null, string, string | null]> = [
      ['SDI', 'Rescue', 'sdi_rescue'],                     // the agency's own name for it
      ['SSI', 'AOW', 'ssi_advanced_open_water'],           // PADI shorthand, back to SSI's one AOW-level card
      ['Padi', 'AOW & nitrox', 'advanced_open_water'],     // agency spelling, specialty noise
      ['padi', 'owsi', 'instructor'],                      // shorthand no agency spells out
      [null, 'Advance Adventure Diver', 'sdi_advanced_adventure'], // one agency uses the name
      ['SSI', 'Rescue', null],                             // Stress & Rescue or Master Diver: unknowable
      [null, 'Master Scuba Diver', null],                  // SDI's or NAUI's: unknowable
      ['PSAI', 'Open Water', null],                        // agency not on the ladder
      ['PADI', 'PE40', null],                              // not a level
    ]
    const ids: string[] = []
    for (const [agency, level] of cases) {
      const u = await diver()
      await legacy(u.id, agency, level)
      ids.push(u.id)
    }

    const { error } = await admin.rpc('backfill_profile_cert_level_codes')
    expect(error).toBeNull()

    for (const [i, [agency, level, code]] of cases.entries()) {
      const after = await cert(ids[i])
      expect(after.cert_level_code, `${agency} + ${level}`).toBe(code)
      if (code === null) {
        expect(after, `${agency} + ${level} left as it was`).toMatchObject({ cert_agency: agency, cert_level: level })
      }
    }
  })

  // The 20260910 pass rewrote "Master Scuba Diver" to "Rescue". Matching the
  // rewritten text would place an SDI diver on rung 3 instead of 4.
  it('prefers what the diver originally typed while the stored text is still the rewrite', async () => {
    const u = await diver()
    await legacy(u.id, 'SDI', 'Rescue')
    const { error } = await admin.from('profile_value_normalizations').insert({
      profile_id: u.id, field: 'cert_level', old_value: 'Master Scuba Diver', new_value: 'Rescue',
    })
    expect(error).toBeNull()

    await admin.rpc('backfill_profile_cert_level_codes')
    expect((await cert(u.id)).cert_level_code).toBe('sdi_master_scuba_diver')
  })

  it('ignores the original once the diver has edited the field since', async () => {
    const u = await diver()
    await admin.from('profile_value_normalizations').insert({
      profile_id: u.id, field: 'cert_level', old_value: 'Master Scuba Diver', new_value: 'Rescue',
    })
    await legacy(u.id, 'SDI', 'Divemaster')

    await admin.rpc('backfill_profile_cert_level_codes')
    expect((await cert(u.id)).cert_level_code).toBe('sdi_divemaster')
  })

  it('logs both rewritten columns and is a no-op the second time', async () => {
    const u = await diver()
    await legacy(u.id, 'Padi', 'Advanced Open Water')

    await admin.rpc('backfill_profile_cert_level_codes')
    await admin.rpc('backfill_profile_cert_level_codes')

    const { data: log } = await admin.from('profile_value_normalizations')
      .select('field, old_value, new_value')
      .eq('profile_id', u.id)
      .order('field')
    expect(log).toEqual([
      { field: 'cert_agency', old_value: 'Padi', new_value: 'PADI' },
      { field: 'cert_level', old_value: 'Advanced Open Water', new_value: 'AOW' },
    ])
  })
})

describe('the application latch', () => {
  it('waits for a picked level, not any text', async () => {
    const u = await diver()
    const base = {
      name: 'Latch Test', date_of_birth: '1990-01-01',
      contact_method: 'line', contact_id: 'latch-line', application_submitted_at: null,
    }
    await admin.from('profiles').update({ ...base, cert_agency: 'PSAI', cert_level: 'PE40' }).eq('id', u.id)
    let { data } = await admin.from('profiles').select('application_submitted_at').eq('id', u.id).single()
    expect(data!.application_submitted_at).toBeNull()

    await admin.from('profiles').update({ cert_level_code: 'open_water' }).eq('id', u.id);
    ({ data } = await admin.from('profiles').select('application_submitted_at').eq('id', u.id).single())
    expect(data!.application_submitted_at).not.toBeNull()
  })
})
