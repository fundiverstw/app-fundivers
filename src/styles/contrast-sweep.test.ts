import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import ts from 'typescript'
import {
  MIN_TEXT_CONTRAST,
  backgroundColorFor,
  contrastRatio,
  readPalette,
  textColorFor,
  type Palette,
  type Rgb,
} from './contrast'

/**
 * Sweeps every JSX element in the app for text painted on a background it
 * cannot be read against — the failure the dark retrofit in `index.css` makes
 * easy to write by accident (a pale `bg-*-50` card whose ink is
 * `text-brand-900`, which the retrofit flips to near-white).
 *
 * Scope, deliberately narrow so a failure is always a real bug:
 *  - Base-state classes only. `hover:`/`focus:`/breakpoint variants are
 *    separate states this sweep does not model.
 *  - Backgrounds resolve up the JSX tree inside one file; a component whose
 *    outermost element sets no background is assumed to sit on the page.
 *  - Where a className expression offers alternatives (a ternary), the element
 *    is only reported when *every* alternative fails.
 */

const GRADIENT = /^bg-(?:linear|gradient|radial|conic)|^bg-\[/
const VARIANT = /^[a-z][\w-]*(?:\[[^\]]*\])?:/

interface Candidate {
  cls: string
  rgb: Rgb
}

interface Context {
  candidates: Candidate[]
  line: number
}

function sourceFiles(): string[] {
  return execSync('git ls-files "src/**/*.tsx"', { encoding: 'utf8', cwd: process.cwd() })
    .trim()
    .split('\n')
    .filter(f => f && !f.includes('.test.'))
}

function classTokens(initializer: ts.JsxAttributeValue): string[] {
  const out: string[] = []
  const push = (text: string) => out.push(...text.split(/\s+/).filter(Boolean))
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) push(node.text)
    else if (ts.isTemplateExpression(node)) {
      push(node.head.text)
      for (const span of node.templateSpans) push(span.literal.text)
    }
    node.forEachChild(visit)
  }
  visit(initializer)
  return [...new Set(out)].filter(t => !VARIANT.test(t))
}

function resolve(
  tokens: string[],
  kind: 'bg' | 'text',
  backdrops: Candidate[],
  palette: Palette,
): { candidates: Candidate[]; unknown: boolean } {
  const lookup = kind === 'bg' ? backgroundColorFor : textColorFor
  const unknown = kind === 'bg' && tokens.some(t => GRADIENT.test(t))
  const seen = new Map<string, Candidate>()
  for (const token of tokens) {
    if (!token.startsWith(`${kind}-`)) continue
    for (const backdrop of backdrops) {
      const rgb = lookup(token, palette, backdrop.rgb)
      if (rgb) seen.set(`${token}|${rgb.r},${rgb.g},${rgb.b}`, { cls: token, rgb })
    }
  }
  return { candidates: [...seen.values()], unknown }
}

interface Violation {
  file: string
  line: number
  bg: string
  bgLine: number
  text: string
  ratio: number
}

function sweepFile(file: string, palette: Palette, page: Candidate): Violation[] {
  const src = readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const violations: Violation[] = []

  const walk = (node: ts.Node, bg: Context | null, text: Context | null) => {
    let childBg = bg
    let childText = text

    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node
      const attr = opening.attributes.properties.find(
        (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === 'className',
      )
      const line = sourceFile.getLineAndCharacterOfPosition(opening.getStart()) .line + 1
      const tokens = attr?.initializer ? classTokens(attr.initializer) : []

      if (tokens.includes('sr-only') || tokens.includes('hidden')) return

      const ownBg = resolve(tokens, 'bg', bg?.candidates ?? [page], palette)
      if (ownBg.unknown) childBg = null
      else if (ownBg.candidates.length) childBg = { candidates: ownBg.candidates, line }

      const backdrop = childBg ?? bg
      const ownText = resolve(tokens, 'text', backdrop?.candidates ?? [], palette)
      if (ownText.candidates.length) childText = { candidates: ownText.candidates, line }

      const declaresColor = ownBg.candidates.length > 0 || ownText.candidates.length > 0
      if (declaresColor && backdrop && childText) {
        let worst: Violation | null = null
        let allFail = true
        for (const b of backdrop.candidates) {
          for (const t of childText.candidates) {
            const ratio = contrastRatio(b.rgb, t.rgb)
            if (ratio >= MIN_TEXT_CONTRAST) {
              allFail = false
            } else if (!worst || ratio < worst.ratio) {
              worst = { file, line, bg: b.cls, bgLine: backdrop.line, text: t.cls, ratio }
            }
          }
        }
        if (allFail && worst) violations.push(worst)
      }
    }

    node.forEachChild(child => walk(child, childBg, childText))
  }

  walk(sourceFile, null, null)
  return violations
}

describe('color-on-color contrast', () => {
  const palette = readPalette(
    readFileSync('node_modules/tailwindcss/theme.css', 'utf8'),
    readFileSync('src/index.css', 'utf8'),
  )
  const page: Candidate = { cls: '<page>', rgb: palette.page }

  it('never paints text on a background it cannot be read against', () => {
    const violations = sourceFiles().flatMap(f => sweepFile(f, palette, page))
    const report = violations
      .sort((a, b) => a.ratio - b.ratio)
      .map(v => `${v.file}:${v.line} — ${v.text} on ${v.bg} (line ${v.bgLine}) = ${v.ratio.toFixed(2)}:1`)
    expect(report).toEqual([])
  })
})
