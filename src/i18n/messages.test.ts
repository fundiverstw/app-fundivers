import { describe, it, expect } from 'vitest'
import { siteConfig } from '../config/site'
import { en } from './messages/en'
import { zhTW } from './messages/zh-TW'
import { ja } from './messages/ja'

// TypeScript already forces every locale catalog to match the English shape (a
// missing or misnamed key fails the build via `const zhTW: Messages`). This test
// is the runtime backstop: it catches shape drift the compiler can't see once
// catalogs grow, and confirms the configured language actually resolves to one.

type Node = Record<string, unknown>

// A sorted list of `path:type` for every leaf — string leaves become
// `nav.calendar:string`, function leaves `shell.pending:function`. Two catalogs
// with the same shape produce identical lists.
function shape(obj: Node, prefix = ''): string[] {
  return Object.entries(obj)
    .flatMap(([k, v]) => {
      const path = prefix ? `${prefix}.${k}` : k
      return v !== null && typeof v === 'object' ? shape(v as Node, path) : [`${path}:${typeof v}`]
    })
    .sort()
}

describe('i18n message catalogs', () => {
  const enShape = shape(en)

  it.each([
    ['zh-TW', zhTW],
    ['ja', ja],
  ])('%s has the same key/type shape as English', (_name, catalog) => {
    expect(shape(catalog as Node)).toEqual(enShape)
  })

  it('resolves a catalog for the configured language', () => {
    const catalogs: Record<string, unknown> = { en, 'zh-TW': zhTW, ja }
    expect(catalogs[siteConfig.locale.language]).toBeDefined()
  })
})
