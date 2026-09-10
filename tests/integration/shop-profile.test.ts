import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser, type TestUser,
} from './helpers'

// shop_profile is world-readable and admin-writable, because the logo it points
// at is chrome on the login page and on the emailed terms-acceptance flow —
// both of which run with no session at all.

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  await admin.from('shop_profile').update({
    logo_path: null, standards_org: null, currency: null, currency_label: null, language: null,
  }).eq('singleton', true)
  await deleteTestUser(admin, adminUser.id)
  await deleteTestUser(admin, diver.id)
})

describe('shop_profile', () => {
  it('is exactly one row, seeded empty', async () => {
    const { data, error } = await admin.from('shop_profile').select('*')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('is readable with no session at all', async () => {
    const { data, error } = await anonClient().from('shop_profile').select('logo_path')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('lets an admin set the shop’s agency', async () => {
    const asAdmin = await userClient(adminUser.email, adminUser.password)
    const { error } = await asAdmin.from('shop_profile').update({ standards_org: 'SSI' }).eq('singleton', true)
    expect(error).toBeNull()

    const { data } = await admin.from('shop_profile').select('standards_org, updated_by').maybeSingle()
    expect(data!.standards_org).toBe('SSI')
    // The trigger stamps who, so an unexplained change has a name against it.
    expect(data!.updated_by).toBe(adminUser.id)
  })

  it('refuses a diver’s write', async () => {
    const asDiver = await userClient(diver.email, diver.password)
    await asDiver.from('shop_profile').update({ standards_org: 'NAUI' }).eq('singleton', true)

    const { data } = await admin.from('shop_profile').select('standards_org').maybeSingle()
    expect(data!.standards_org).not.toBe('NAUI')
  })

  // A typo'd agency leaves every rung on the equivalence chart unlabelled,
  // which reads as missing data rather than as a bad setting — so it is
  // refused at the write rather than discovered later.
  it('refuses an agency the ladder has never heard of', async () => {
    const { error } = await admin.from('shop_profile')
      .update({ standards_org: 'ACME DIVING' }).eq('singleton', true)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/ACME DIVING/)
  })

  it('cannot be given a second row', async () => {
    const { error } = await admin.from('shop_profile').insert({ singleton: true } as never)
    expect(error).not.toBeNull()
  })
})

describe('cert_level_equivalences', () => {
  it('lines every agency up against the chosen one', async () => {
    const { data, error } = await admin.rpc('cert_level_equivalences', { p_organization: 'SSI' })
    expect(error).toBeNull()

    const rows = data!
    expect(rows.length).toBeGreaterThan(20)

    // NAUI's Advanced Scuba Diver and PADI's AOW are one rung, so both carry
    // SSI's name for it. That equality is the whole point of the chart.
    const nauiAdvanced = rows.find(r => r.organization === 'NAUI' && r.name === 'Advanced Scuba Diver')
    const padiAow = rows.find(r => r.organization === 'PADI' && r.name === 'AOW')
    expect(nauiAdvanced!.hub_code).toBe(padiAow!.hub_code)
    expect(nauiAdvanced!.equivalent_name).toBe(padiAow!.equivalent_name)
    expect(nauiAdvanced!.equivalent_name).toBe('Advanced Open Water Diver')
  })

  it('names every PADI rung as itself when PADI is the chosen agency', async () => {
    const { data } = await admin.rpc('cert_level_equivalences', { p_organization: 'PADI' })
    for (const row of data!.filter(r => r.organization === 'PADI')) {
      expect(row.equivalent_name).toBe(row.name)
    }
  })

  // SSI's ladder stops at instructor, so the rungs above it have no SSI name.
  // Null is the honest answer; inventing one would claim a qualification.
  it('leaves a rung the chosen agency has no name for null', async () => {
    const { data } = await admin.rpc('cert_level_equivalences', { p_organization: 'SSI' })
    const msdt = data!.find(r => r.organization === 'PADI' && r.name === 'MSDT')
    expect(msdt!.equivalent_name).toBeNull()
  })

  it('falls back to the hub agency when given none', async () => {
    const { data } = await admin.rpc('cert_level_equivalences', {})
    const padiOw = data!.find(r => r.organization === 'PADI' && r.name === 'OW')
    expect(padiOw!.equivalent_name).toBe('OW')
  })
})

// The build reads this row to apply the shop's currency and language, because
// neither can be applied at runtime. It reads it over PostgREST with the anon
// key — no service role, no session — so what actually has to hold is that the
// row is reachable that way. Proven against the live stack rather than a mock
// of it, because a mock cannot fail the way RLS can.
describe('the build-time overlay read', () => {
  it('reads the compiled-in settings with the anon key alone', async () => {
    await admin.from('shop_profile')
      .update({ currency: 'JPY', currency_label: '¥', language: 'ja' })
      .eq('singleton', true)

    const { fetchShopProfileOverlay } = await import('../../src/vite/shop-profile-overlay')
    const overlay = await fetchShopProfileOverlay({
      VITE_SUPABASE_URL: process.env.API_URL,
      VITE_SUPABASE_ANON_KEY: process.env.ANON_KEY,
    })

    expect(overlay).toEqual({ currency: 'JPY', currencyLabel: '¥', language: 'ja' })
  })

  it('reports no preference when the shop has expressed none', async () => {
    await admin.from('shop_profile')
      .update({ currency: null, currency_label: null, language: null })
      .eq('singleton', true)

    const { fetchShopProfileOverlay } = await import('../../src/vite/shop-profile-overlay')
    expect(await fetchShopProfileOverlay({
      VITE_SUPABASE_URL: process.env.API_URL,
      VITE_SUPABASE_ANON_KEY: process.env.ANON_KEY,
    })).toEqual({ currency: null, currencyLabel: null, language: null })
  })
})
