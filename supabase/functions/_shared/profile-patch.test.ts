import { describe, it, expect } from 'vitest'
import { sanitizeProfilePatch, PROFILE_PATCH_ALLOW } from './profile-patch'

// Security-audit C2 contract. The allowlist + sanitizer are the only
// thing between an attacker's POST /create-registration body and the
// service-role profiles UPDATE. If a key falls out of these tests
// without a paired SPA-side change in
// src/components/register/RegisterForm.tsx, treat that as a regression,
// not a test-suite failure.

describe('sanitizeProfilePatch — blocked attack keys', () => {
  it('drops role (C2: pre-auth admin promotion)', () => {
    expect(sanitizeProfilePatch({ role: 'admin' })).toEqual({})
    expect(sanitizeProfilePatch({ role: 'staff', name: 'Mallory' }))
      .toEqual({ name: 'Mallory' })
  })

  it('drops status (manual-verification gate)', () => {
    expect(sanitizeProfilePatch({ status: 'active' })).toEqual({})
    expect(sanitizeProfilePatch({ status: 'pending' })).toEqual({})
  })

  it('drops parent_account (parent-of-child escalation H1)', () => {
    expect(sanitizeProfilePatch({ parent_account: 'someone-else-uuid' })).toEqual({})
  })

  it('drops gear-size columns (admin-only per 20260505020000)', () => {
    expect(sanitizeProfilePatch({
      fin_size: 'XL', bcd_size: 'L', wetsuit_size: 'M',
    })).toEqual({})
  })

  it('drops identity / FK / timestamp columns', () => {
    expect(sanitizeProfilePatch({
      id:                       'pwned',
      email:                    'attacker@example.com',
      created_at:               '1970-01-01',
      updated_at:               '1970-01-01',
      application_submitted_at: '1970-01-01',
    })).toEqual({})
  })

  it('drops admin-only nullable boolean flags (audit-log, retention)', () => {
    expect(sanitizeProfilePatch({
      admin_notes:    'self-vouch',
      retention_hold: true,
    })).toEqual({})
  })

  it('kitchen-sink: every attack key at once is fully scrubbed', () => {
    const malicious: Record<string, unknown> = {
      id:             'pwned',
      role:           'admin',
      status:         'active',
      parent_account: 'someone-else',
      fin_size:       'pwned',
      bcd_size:       'pwned',
      wetsuit_size:   'pwned',
      email:          'attacker@example.com',
      created_at:     '1970-01-01',
      updated_at:     '1970-01-01',
    }
    expect(sanitizeProfilePatch(malicious)).toEqual({})
  })
})

describe('sanitizeProfilePatch — allowed keys (SPA registration-form contract)', () => {
  // Pinned against src/components/register/RegisterForm.tsx's
  // profilePatch builder (~line 589). When the SPA adds a column to
  // profile_patch, add it both here AND in PROFILE_PATCH_ALLOW.
  const SPA_PATCH_FIELDS: ReadonlyArray<string> = [
    'name',
    'nickname',
    'date_of_birth',
    'nationality',
    'gender',
    'id_number',
    'contact_method',
    'contact_id',
    'cert_agency',
    'cert_level',
    'uncertified',
    'logged_dives',
    'nitrox_certified',
    'nitrox_card_path',
    'deep_certified',
    'deep_card_path',
    'cert_card_path',
    'emergency_contact_name',
    'emergency_contact_phone',
  ]

  it('every SPA-emitted key survives the sanitizer', () => {
    const patch = Object.fromEntries(SPA_PATCH_FIELDS.map((k, i) => [k, `v${i}`]))
    expect(sanitizeProfilePatch(patch)).toEqual(patch)
  })

  it('PROFILE_PATCH_ALLOW matches the SPA field list exactly (no drift either direction)', () => {
    expect([...PROFILE_PATCH_ALLOW].sort()).toEqual([...SPA_PATCH_FIELDS].sort())
  })

  it('preserves null values (SPA uses null to clear a column)', () => {
    expect(sanitizeProfilePatch({ name: null, nickname: null }))
      .toEqual({ name: null, nickname: null })
  })

  it('preserves numeric and boolean values verbatim', () => {
    expect(sanitizeProfilePatch({
      logged_dives:     42,
      nitrox_certified: true,
      deep_certified:   false,
    })).toEqual({
      logged_dives:     42,
      nitrox_certified: true,
      deep_certified:   false,
    })
  })
})

describe('sanitizeProfilePatch — mixed attack + legit', () => {
  it('drops attack keys but keeps legitimate ones in the same patch', () => {
    expect(sanitizeProfilePatch({
      role:       'admin',           // dropped
      status:     'active',          // dropped
      name:  'Mallory',         // kept
      cert_level: 'Open Water',      // kept
      fin_size:   'XL',              // dropped
    })).toEqual({
      name:  'Mallory',
      cert_level: 'Open Water',
    })
  })
})

describe('sanitizeProfilePatch — defensive shape handling', () => {
  it('null input → {}', () => {
    expect(sanitizeProfilePatch(null)).toEqual({})
  })

  it('undefined input → {}', () => {
    expect(sanitizeProfilePatch(undefined)).toEqual({})
  })

  it('string input → {} (does not throw)', () => {
    expect(sanitizeProfilePatch('admin')).toEqual({})
  })

  it('array input → {} (does not iterate index keys)', () => {
    expect(sanitizeProfilePatch(['name', 'role'])).toEqual({})
  })

  it('does not mutate input', () => {
    const input: Record<string, unknown> = { role: 'admin', name: 'M' }
    const out   = sanitizeProfilePatch(input)
    expect(input).toEqual({ role: 'admin', name: 'M' })
    expect(out).toEqual({ name: 'M' })
    expect(out).not.toBe(input)
  })

  it('does not leak prototype keys into the output', () => {
    // Even if Object.keys exposed "__proto__" via own-enumerable, the
    // allowlist filter discards it.
    const out = sanitizeProfilePatch({ '__proto__': { hijack: true }, constructor: 'pwn' } as never)
    expect(out).toEqual({})
    expect(Object.prototype.hasOwnProperty.call(out, 'hijack')).toBe(false)
    // The Object prototype itself was not modified.
    expect((Object.prototype as unknown as { hijack?: boolean }).hijack).toBeUndefined()
  })
})
