// Integration tests for coral surveys (20260822000000) — CoralWatch Coral
// Health Chart records that reach the crowd only once staff approve them.
// What we lock in:
//   1. Both tables are read-only to `authenticated`: every write goes through
//      an RPC, so a diver cannot mint an already-approved survey or attach a
//      colony to somebody else's.
//   2. submit_coral_survey files a pending survey with its colonies, replaces
//      the colony list wholesale on revision, and refuses a future date, an
//      empty colony list, and any revision of a reviewed survey.
//   3. The chart's own rules are enforced in the schema: hue and level
//      vocabularies, and a darkest shade no paler than the lightest.
//   4. A pending survey is visible to its author and to staff, and to nobody
//      else; approved ones are visible to every signed-in diver.
//   5. The queue and the ruling RPC are staff/admin only.
//   6. Surveys hang off the dive_sites catalog, which cannot be deleted out
//      from under them, and colonies die with their survey.
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

const admin = adminClient()
let staff: TestUser
let diver: TestUser
let otherDiver: TestUser
let siteId: string

const TODAY = new Date().toLocaleDateString('en-CA')
const YESTERDAY = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA')
const TOMORROW = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA')
// The guard allows a day of slack, because the client sends a shop-timezone
// date and the database clock is UTC. Two days out is unambiguously future.
const NEXT_WEEK = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString('en-CA')

const colony = (over: Record<string, unknown> = {}) => ({
  coral_type: 'branching',
  lightest_hue: 'C', lightest_level: 3,
  darkest_hue: 'C', darkest_level: 5,
  diameter_cm: 30,
  ...over,
})

async function clearSurveys() {
  await admin.from('coral_surveys').delete().eq('site_id', siteId)
}

async function coloniesOf(surveyId: string) {
  const { data } = await admin
    .from('coral_survey_colonies').select('*').eq('survey_id', surveyId).order('ordinal')
  return (data ?? []) as Array<Record<string, unknown>>
}

beforeAll(async () => {
  staff = await createTestUser(admin, { role: 'staff' })
  diver = await createTestUser(admin, { role: 'diver' })
  otherDiver = await createTestUser(admin, { role: 'diver' })
  const { data, error } = await admin
    .from('dive_sites')
    .insert({ name: `Coral Reef ${crypto.randomUUID().slice(0, 8)}`, kind: 'dive' } as never)
    .select('id').single()
  if (error) throw new Error(`dive site insert failed: ${error.message}`)
  siteId = (data as { id: string }).id
  await admin.from('profiles').update({ name: 'Coral Diver' } as never).eq('id', diver.id)
})

afterAll(async () => {
  await clearSurveys()
  await admin.from('dive_sites').delete().eq('id', siteId)
  for (const u of [staff, diver, otherDiver]) await deleteTestUser(admin, u.id)
})

describe('coral survey writes are RPC-only', () => {
  it('refuses a direct survey insert from a diver', async () => {
    const client = await userClient(diver.email, diver.password)
    const { error } = await client.from('coral_surveys').insert({
      diver_id: diver.id, site_id: siteId, surveyed_on: YESTERDAY, status: 'approved',
    } as never)
    expect(error).not.toBeNull()
  })

  it('refuses a direct colony insert', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    const { data: id } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: YESTERDAY, p_colonies: [colony()],
    } as never)
    const { error } = await client.from('coral_survey_colonies').insert({
      survey_id: id, ordinal: 2, coral_type: 'soft',
      lightest_hue: 'B', lightest_level: 1, darkest_hue: 'B', darkest_level: 1,
    } as never)
    expect(error).not.toBeNull()
  })
})

describe('submit_coral_survey', () => {
  it('files a pending survey with its colonies, numbered in order', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    const { data: id, error } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId,
      p_surveyed_on: YESTERDAY,
      p_colonies: [colony(), colony({ coral_type: 'soft', lightest_level: 1, darkest_level: 2 })],
      p_surveyed_at: '09:30',
      p_depth_m: 8.5,
      p_water_temp_c: 29.1,
    } as never)
    expect(error).toBeNull()

    const { data: row } = await admin
      .from('coral_surveys').select('*').eq('id', id as string).single()
    const survey = row as Record<string, unknown>
    expect(survey.status).toBe('pending')
    expect(survey.diver_id).toBe(diver.id)
    expect(Number(survey.depth_m)).toBe(8.5)
    expect(Number(survey.water_temp_c)).toBe(29.1)
    // Default when the caller does not say how the colonies were chosen.
    expect(survey.survey_method).toBe('random')

    const colonies = await coloniesOf(id as string)
    expect(colonies.map(c => c.ordinal)).toEqual([1, 2])
    expect(colonies[1].coral_type).toBe('soft')
  })

  // A revision is the diver saying what they saw. Merging would leave rows
  // from an earlier attempt standing in a survey nobody meant to include them.
  it('replaces the colony list wholesale on revision', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    const { data: first } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: YESTERDAY,
      p_colonies: [colony(), colony(), colony()],
    } as never)
    expect(await coloniesOf(first as string)).toHaveLength(3)

    const { data: second, error } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: YESTERDAY,
      p_colonies: [colony({ coral_type: 'plate' })],
    } as never)
    expect(error).toBeNull()
    expect(second).toBe(first)

    const colonies = await coloniesOf(first as string)
    expect(colonies).toHaveLength(1)
    expect(colonies[0].coral_type).toBe('plate')
    expect(colonies[0].ordinal).toBe(1)
  })

  it('refuses a date nobody could have observed', async () => {
    const client = await userClient(diver.email, diver.password)
    const { error } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: NEXT_WEEK, p_colonies: [colony()],
    } as never)
    expect(error).not.toBeNull()
  })

  // The client sends a date in the shop's timezone and the database clock is
  // UTC, so a same-day survey filed before 08:00 in Taipei arrives dated
  // "tomorrow". Refusing it would break every early-morning submission.
  it('accepts tomorrow, absorbing the shop-to-database timezone offset', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    const { error } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: TOMORROW, p_colonies: [colony()],
    } as never)
    expect(error).toBeNull()
  })

  // Not an observation that the reef is empty; a form somebody abandoned.
  it('refuses a survey with no colonies', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    const { error } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: TODAY, p_colonies: [],
    } as never)
    expect(error).not.toBeNull()
  })

  it('refuses to reopen a survey staff have already ruled on', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    const { data: id } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: YESTERDAY, p_colonies: [colony()],
    } as never)
    const staffClient = await userClient(staff.email, staff.password)
    await staffClient.rpc('moderate_coral_survey', {
      p_survey_id: id as string, p_status: 'approved',
    } as never)

    const { error } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: YESTERDAY, p_colonies: [colony({ coral_type: 'soft' })],
    } as never)
    expect(error).not.toBeNull()
  })
})

describe('the chart vocabulary is enforced in the schema', () => {
  it('rejects a hue outside the four printed columns', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    const { error } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: TODAY,
      p_colonies: [colony({ lightest_hue: 'A' })],
    } as never)
    expect(error).not.toBeNull()
  })

  it('rejects a level outside 1 to 6', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    const { error } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: TODAY,
      p_colonies: [colony({ darkest_level: 7 })],
    } as never)
    expect(error).not.toBeNull()
  })

  it('rejects a growth form the chart does not distinguish', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    const { error } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: TODAY,
      p_colonies: [colony({ coral_type: 'encrusting' })],
    } as never)
    expect(error).not.toBeNull()
  })

  // The chart is read palest first, so this is a transposed pair.
  it('rejects a darkest shade paler than the lightest', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    const { error } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: TODAY,
      p_colonies: [colony({ lightest_level: 5, darkest_level: 2 })],
    } as never)
    expect(error).not.toBeNull()
  })

  it('accepts equal shades — a colony of one shade is ordinary', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    const { error } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: TODAY,
      p_colonies: [colony({ lightest_level: 4, darkest_level: 4 })],
    } as never)
    expect(error).toBeNull()
  })
})

describe('who can see a survey', () => {
  it('shows a pending survey to its author and to staff, and to nobody else', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    const { data: id } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: YESTERDAY, p_colonies: [colony()],
    } as never)

    const mine = await client.from('coral_surveys').select('id').eq('id', id as string)
    expect(mine.data?.length).toBe(1)

    const staffClient = await userClient(staff.email, staff.password)
    const theirs = await staffClient.from('coral_surveys').select('id').eq('id', id as string)
    expect(theirs.data?.length).toBe(1)

    const stranger = await userClient(otherDiver.email, otherDiver.password)
    const hidden = await stranger.from('coral_surveys').select('id').eq('id', id as string)
    expect(hidden.data?.length).toBe(0)
  })

  it('shows an approved survey, and its colonies, to any signed-in diver', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    const { data: id } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: YESTERDAY, p_colonies: [colony()],
    } as never)
    const staffClient = await userClient(staff.email, staff.password)
    await staffClient.rpc('moderate_coral_survey', {
      p_survey_id: id as string, p_status: 'approved',
    } as never)

    const stranger = await userClient(otherDiver.email, otherDiver.password)
    const seen = await stranger.from('coral_surveys').select('id').eq('id', id as string)
    expect(seen.data?.length).toBe(1)
    const seenColonies = await stranger
      .from('coral_survey_colonies').select('id').eq('survey_id', id as string)
    expect(seenColonies.data?.length).toBe(1)
  })

  it('returns approved surveys with their colonies aggregated in', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    const { data: id } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: YESTERDAY,
      p_colonies: [colony(), colony({ coral_type: 'soft' })],
    } as never)
    const staffClient = await userClient(staff.email, staff.password)
    await staffClient.rpc('moderate_coral_survey', {
      p_survey_id: id as string, p_status: 'approved',
    } as never)

    const { data, error } = await client.rpc('coral_surveys_in_range', {
      p_from: YESTERDAY, p_to: TODAY,
    } as never)
    expect(error).toBeNull()
    const rows = (data ?? []) as Array<{ id: string; colonies: unknown[]; diver_display: string }>
    const row = rows.find(r => r.id === id)
    expect(row).toBeTruthy()
    expect(row!.colonies).toHaveLength(2)
    expect(row!.diver_display).toBe('Coral Diver')
  })
})

describe('the queue and the ruling are staff-only', () => {
  it('refuses the queue to a diver', async () => {
    const client = await userClient(diver.email, diver.password)
    const { error } = await client.rpc('coral_pending_surveys')
    expect(error).not.toBeNull()
  })

  it('refuses the ruling to a diver', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    const { data: id } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: YESTERDAY, p_colonies: [colony()],
    } as never)
    const { error } = await client.rpc('moderate_coral_survey', {
      p_survey_id: id as string, p_status: 'approved',
    } as never)
    expect(error).not.toBeNull()
  })

  it('refuses a status that is neither approved nor rejected', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    const { data: id } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: YESTERDAY, p_colonies: [colony()],
    } as never)
    const staffClient = await userClient(staff.email, staff.password)
    const { error } = await staffClient.rpc('moderate_coral_survey', {
      p_survey_id: id as string, p_status: 'pending',
    } as never)
    expect(error).not.toBeNull()
  })

  it('lists a pending survey in the queue for staff', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    const { data: id } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: YESTERDAY, p_colonies: [colony()],
    } as never)
    const staffClient = await userClient(staff.email, staff.password)
    const { data } = await staffClient.rpc('coral_pending_surveys')
    const rows = (data ?? []) as Array<{ id: string }>
    expect(rows.some(r => r.id === id)).toBe(true)
  })
})

describe('the site catalog holds the surveys up', () => {
  it('refuses to delete a site that carries surveys', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: YESTERDAY, p_colonies: [colony()],
    } as never)
    const { error } = await admin.from('dive_sites').delete().eq('id', siteId)
    expect(error).not.toBeNull()
  })

  it('takes a survey colonies with it when the survey goes', async () => {
    await clearSurveys()
    const client = await userClient(diver.email, diver.password)
    const { data: id } = await client.rpc('submit_coral_survey', {
      p_site_id: siteId, p_surveyed_on: YESTERDAY, p_colonies: [colony(), colony()],
    } as never)
    await admin.from('coral_surveys').delete().eq('id', id as string)
    expect(await coloniesOf(id as string)).toHaveLength(0)
  })
})
