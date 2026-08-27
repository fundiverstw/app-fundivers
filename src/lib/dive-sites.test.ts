import { describe, it, expect } from 'vitest'
import { SITE_KINDS } from '../types/database'
import { siteName, otherSiteNames } from './dive-sites'
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

const batCave = { name: 'Bat Cave', name_zh_tw: '蝙蝠洞', name_ja: 'バット・ケーブ' }
const diverAdded = { name: 'Sharks Point', name_zh_tw: null, name_ja: null }

describe('siteName', () => {
  it('shows the place in the language this deployment renders in', () => {
    expect(siteName(batCave, 'en')).toBe('Bat Cave')
    expect(siteName(batCave, 'zh-TW')).toBe('蝙蝠洞')
    expect(siteName(batCave, 'ja')).toBe('バット・ケーブ')
  })

  // A diver adding a place supplies the name they know it by and no others. A
  // Chinese deployment showing a blank where a site should be is worse than
  // showing it in English.
  it('falls back to the English name rather than showing nothing', () => {
    expect(siteName(diverAdded, 'zh-TW')).toBe('Sharks Point')
    expect(siteName(diverAdded, 'ja')).toBe('Sharks Point')
  })

  it('treats an empty translation as absent, not as a name', () => {
    expect(siteName({ ...batCave, name_zh_tw: '' }, 'zh-TW')).toBe('Bat Cave')
  })
})

describe('otherSiteNames', () => {
  it('lists the names not already on screen, so a suggestion can be recognised', () => {
    expect(otherSiteNames(batCave, 'en')).toEqual(['蝙蝠洞', 'バット・ケーブ'])
    expect(otherSiteNames(batCave, 'zh-TW')).toEqual(['Bat Cave', 'バット・ケーブ'])
  })

  it('has nothing to add for a place with one name', () => {
    expect(otherSiteNames(diverAdded, 'en')).toEqual([])
  })
})
