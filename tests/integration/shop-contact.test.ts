import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

// Pins the shop-authored contact contract (20260905120000): the details and
// the buttons are publicly readable — they appear on pages a diver reaches
// before approval and on the terms-acceptance page, which runs from an emailed
// link with no session — and admin-written. The `kind` vocabulary and the
// per-kind URL rule are constraints rather than client-side validation,
// because a dead button is only discovered by the diver who taps it.

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser

const createdIds: string[] = []

async function makeChannel(client: ReturnType<typeof adminClient>, values: Record<string, unknown>) {
  const { data, error } = await client
    .from('contact_channels')
    .insert(values as never)
    .select('id')
    .maybeSingle()
  if (data?.id) createdIds.push(data.id as string)
  return { data, error }
}

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver     = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  for (const id of createdIds) await admin.from('contact_channels').delete().eq('id', id)
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (diver)     await deleteTestUser(admin, diver.id)
})

describe('shop_contact', () => {
  it('is exactly one row, and stays one', async () => {
    const { data, error } = await admin.from('shop_contact').select('*')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)

    const second = await admin.from('shop_contact').insert({ singleton: true } as never)
    expect(second.error).not.toBeNull()
  })

  // The terms-acceptance page runs from an emailed link with no session at all,
  // and it prints this address when a token has expired.
  it('is readable without a session', async () => {
    const { data, error } = await anonClient().from('shop_contact').select('email').maybeSingle()
    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })

  it('lets an admin publish new details', async () => {
    const client = await userClient(adminUser.email, adminUser.password)
    const { error } = await client
      .from('shop_contact')
      .update({ phone: '+886 900-111-222' } as never)
      .eq('singleton', true)
    expect(error).toBeNull()

    const { data } = await admin.from('shop_contact').select('phone').maybeSingle()
    expect(data!.phone).toBe('+886 900-111-222')
  })

  it("refuses a diver's edit, silently leaving the row alone", async () => {
    const client = await userClient(diver.email, diver.password)
    await client.from('shop_contact').update({ email: 'hijack@example.com' } as never).eq('singleton', true)

    const { data } = await admin.from('shop_contact').select('email').maybeSingle()
    expect(data!.email).not.toBe('hijack@example.com')
  })

  // Empty means "not published yet" and every surface handles it. What is not
  // allowed is something that is not an address at all.
  it('takes an empty email but not a broken one', async () => {
    const { error: blank } = await admin
      .from('shop_contact').update({ email: '' } as never).eq('singleton', true)
    expect(blank).toBeNull()

    const { error: broken } = await admin
      .from('shop_contact').update({ email: 'not an address' } as never).eq('singleton', true)
    expect(broken).not.toBeNull()

    await admin.from('shop_contact').update({ email: 'shop@example.com' } as never).eq('singleton', true)
  })

  it('refuses a map link that is not a link', async () => {
    const { error } = await admin
      .from('shop_contact').update({ maps_url: 'the corner of 4th' } as never).eq('singleton', true)
    expect(error).not.toBeNull()
  })
})

describe('contact_channels', () => {
  it('ships the buttons the Contact page used to hardcode', async () => {
    const { data, error } = await admin
      .from('contact_channels').select('kind, url').order('sort_order')
    expect(error).toBeNull()
    const kinds = (data ?? []).map(c => c.kind)
    expect(kinds).toContain('line')
    expect(kinds).toContain('whatsapp')
  })

  it('is readable before sign-in, like the details', async () => {
    const { data, error } = await anonClient()
      .from('contact_channels').select('kind').eq('active', true)
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  it('lets an admin add, retire and remove one', async () => {
    const client = await userClient(adminUser.email, adminUser.password)
    const { data, error } = await client
      .from('contact_channels')
      .insert({ kind: 'telegram', url: 'https://t.me/example', sort_order: 9 } as never)
      .select('id').maybeSingle()
    expect(error).toBeNull()
    const id = data!.id as string
    createdIds.push(id)

    const retired = await client.from('contact_channels').update({ active: false } as never).eq('id', id)
    expect(retired.error).toBeNull()

    const removed = await client.from('contact_channels').delete().eq('id', id)
    expect(removed.error).toBeNull()
  })

  it('is closed to divers, who can read it and nothing else', async () => {
    const client = await userClient(diver.email, diver.password)
    const { error: readErr } = await client.from('contact_channels').select('id').limit(1)
    expect(readErr).toBeNull()

    const { error } = await client
      .from('contact_channels')
      .insert({ kind: 'other', url: 'https://evil.example' } as never)
    expect(error).not.toBeNull()
  })

  // The glyph and the brand color for a kind live in code, so a kind the code
  // does not know would render as a button with no icon.
  it('refuses a service outside the vocabulary', async () => {
    const { error } = await makeChannel(admin, { kind: 'myspace', url: 'https://example.com' })
    expect(error).not.toBeNull()
  })

  // A chat service holds a link; phone and SMS hold a bare number, because
  // that is what an admin types into a box labelled "phone number".
  it('holds a link for a chat service and a number for a phone one', async () => {
    const link = await makeChannel(admin, { kind: 'telegram', url: 'https://t.me/ok' })
    expect(link.error).toBeNull()

    const notALink = await makeChannel(admin, { kind: 'telegram', url: 't.me/ok' })
    expect(notALink.error).not.toBeNull()

    const number = await makeChannel(admin, { kind: 'phone', url: '+886 909-083-683' })
    expect(number.error).toBeNull()

    const linkAsNumber = await makeChannel(admin, { kind: 'phone', url: 'https://example.com' })
    expect(linkAsNumber.error).not.toBeNull()
  })

  it('refuses a button label longer than a button', async () => {
    const { error } = await makeChannel(admin, {
      kind: 'other', url: 'https://example.com', label: 'x'.repeat(61),
    })
    expect(error).not.toBeNull()
  })
})
