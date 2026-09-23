import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, createTestUser, deleteTestUser, type TestUser } from './helpers'

// create-child-account lets any active diver mint an auth user for an email
// address of their choosing. Unbounded, that is both a spam amplifier pointed
// through the shop's SMTP quota and a way to squat other people's addresses.
// trg_profiles_child_account_cap is the ceiling; the edge function's pre-check
// only exists to phrase the refusal nicely, so the rule is pinned here at the
// layer that actually enforces it.
// See 20260812000000_cap_child_accounts_per_parent.sql.

const admin = adminClient()
const CAP = 10

let parent: TestUser
let staffParent: TestUser
const children: string[] = []

/** A profile row with no auth user — enough to exercise the parent link. */
async function makeChildProfile(parentId: string | null): Promise<{ id: string; error: string | null }> {
  const child = await createTestUser(admin, { role: 'diver' })
  children.push(child.id)
  if (parentId === null) return { id: child.id, error: null }
  const { error } = await admin
    .from('profiles').update({ parent_account: parentId } as never).eq('id', child.id)
  return { id: child.id, error: error?.message ?? null }
}

beforeAll(async () => {
  parent      = await createTestUser(admin, { role: 'diver' })
  staffParent = await createTestUser(admin, { role: 'staff' })
}, 120_000)

afterAll(async () => {
  for (const id of children) await deleteTestUser(admin, id)
  if (parent)      await deleteTestUser(admin, parent.id)
  if (staffParent) await deleteTestUser(admin, staffParent.id)
}, 120_000)

describe('child-account cap', () => {
  it(`lets a diver reach ${CAP} children and refuses the next one`, async () => {
    for (let i = 0; i < CAP; i++) {
      const { error } = await makeChildProfile(parent.id)
      expect(error, `child ${i + 1} of ${CAP} should be accepted`).toBeNull()
    }

    const overflow = await makeChildProfile(parent.id)
    expect(overflow.error).toMatch(/maximum/i)
  }, 300_000)

  it('does not cap a staff account, which mints walk-ins legitimately', async () => {
    for (let i = 0; i < CAP + 1; i++) {
      const { error } = await makeChildProfile(staffParent.id)
      expect(error).toBeNull()
    }
  }, 300_000)

  it('leaves updates that do not touch parent_account alone once at the cap', async () => {
    // The cap must not turn every later profile edit on a full family into a
    // failure — the trigger fires on UPDATE OF parent_account, so a plain
    // rename of an existing child has to keep working.
    const someChild = children[0]
    const { error } = await admin
      .from('profiles').update({ name: 'Renamed Child' } as never).eq('id', someChild)
    expect(error).toBeNull()
  })
})
