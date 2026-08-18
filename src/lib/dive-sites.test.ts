import { describe, it, expect } from 'vitest'
import { SITE_KINDS } from '../types/database'
import { SITE_CONDITION_KINDS } from './event-kinds'

// Two sides of the same question: `recordsSiteConditions` decides which event
// kinds the app offers a place for, and `dive_sites_kind_check` decides which
// ones the DB will store. A kind added to one and not the other is a picker
// whose options the database rejects — cheap to assert, invisible otherwise.
describe('dive-site vocabulary', () => {
  it('matches the kinds the app collects site conditions for', () => {
    expect([...SITE_KINDS]).toEqual([...SITE_CONDITION_KINDS])
  })
})
