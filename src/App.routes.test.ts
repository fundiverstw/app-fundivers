import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

/**
 * Which guard each route sits behind, read out of App.tsx itself.
 *
 * Every other test renders a page or a guard in isolation, which says nothing
 * about whether the two were ever wired together. A route moved one level up
 * in the tree — out of AdminRoute and into the block every signed-in diver
 * reaches — type-checks, lints, and passes every component test in the repo,
 * while quietly opening a staff-only page to everyone.
 *
 * Parsing the source rather than mounting the app is deliberate: mounting
 * proves the behaviour of one path through a tree of providers, and this is a
 * question about the shape of the tree.
 */
function guardsFor(path: string): string[] {
  const file = 'src/App.tsx'
  const source = ts.createSourceFile(
    file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
  )

  const found: string[] = []
  const guards: string[] = []

  /** The component named by a JSX element's `element={<X />}` attribute. */
  const elementProp = (node: ts.JsxOpeningLikeElement): string | null => {
    for (const prop of node.attributes.properties) {
      if (!ts.isJsxAttribute(prop) || prop.name.getText() !== 'element') continue
      const value = prop.initializer
      if (!value || !ts.isJsxExpression(value) || !value.expression) continue
      const inner = value.expression
      if (ts.isJsxSelfClosingElement(inner)) return inner.tagName.getText()
      if (ts.isJsxElement(inner)) return inner.openingElement.tagName.getText()
    }
    return null
  }

  const pathProp = (node: ts.JsxOpeningLikeElement): string | null => {
    for (const prop of node.attributes.properties) {
      if (!ts.isJsxAttribute(prop) || prop.name.getText() !== 'path') continue
      const value = prop.initializer
      if (value && ts.isStringLiteral(value)) return value.text
    }
    return null
  }

  const walk = (node: ts.Node): void => {
    const opening = ts.isJsxElement(node) ? node.openingElement
      : ts.isJsxSelfClosingElement(node) ? node
      : null

    if (opening && opening.tagName.getText() === 'Route') {
      if (pathProp(opening) === path) found.push(...guards)
      const guard = elementProp(opening)
      // A Route with an `element` and children is a layout: everything under
      // it renders inside that component, which is what a guard is.
      if (guard && ts.isJsxElement(node)) {
        guards.push(guard)
        node.children.forEach(walk)
        guards.pop()
        return
      }
    }
    node.forEachChild(walk)
  }

  walk(source)
  return found
}

describe('route guards', () => {
  // The one the shop asked for twice: staff-facing for now, because the editor
  // is one tap from writing a depth onto a map everyone else reads.
  it('keeps the dive-site maps behind AdminRoute', () => {
    expect(guardsFor('/site-maps')).toContain('AdminRoute')
  })

  it('keeps the diver surfaces where every signed-in diver can reach them', () => {
    for (const path of ['/almanac', '/coral', '/calendar']) {
      expect(guardsFor(path)).not.toContain('AdminRoute')
      expect(guardsFor(path)).toContain('ProtectedRoute')
    }
  })

  it('leaves nothing on a path the parser cannot find, which would pass vacuously', () => {
    expect(guardsFor('/site-maps').length).toBeGreaterThan(0)
    expect(guardsFor('/no-such-route')).toEqual([])
  })
})
