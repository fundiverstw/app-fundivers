import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Every module that composes text a diver or the shop will read — an email
// body, a PDF page, a file inside an export — must take that text from the
// message catalog. A bare English literal in one of these files is not a
// visible bug on an English deployment; it just quietly stays English when the
// shop runs in Chinese or Japanese. Six emails, a waiver attestation page, a
// backup README and the group PDF's transport label all shipped that way.
//
// So scan the source for prose literals and hold the result against an
// allowlist. The allowlist is the point: each entry is a decision someone made
// on purpose, and a new literal has to be argued for rather than merely
// committed.

const ROOT = join(process.cwd(), 'supabase/functions')

/** Modules whose whole job is composing outbound copy. */
const OUTBOUND = [
  '_shared/pdf.ts',
  '_shared/waiver-record-pdf.ts',
  '_shared/event-cancellation-email.ts',
  '_shared/package-registration-email.ts',
  '_shared/scheduled-trip-registration-email.ts',
  '_shared/terms-consent-email.ts',
  '_shared/waitlist-confirmed-email.ts',
  '_shared/trusted-partners.ts',
  '_shared/partner-connect.ts',
  '_shared/payment-instructions.ts',
  'create-registration/handler.ts',
  'send-group-summary/handler.ts',
  'export-database-backup/handler.ts',
  'export-event-divers/index.ts',
  'notify-application-decision/index.ts',
  'notify-booking-confirmed/index.ts',
  'notify-event-cancellation/index.ts',
  'notify-waitlist-offer/index.ts',
  'create-child-account/index.ts',
  'request-dive-log-export/index.ts',
  'admin-create-diver/index.ts',
  'send-terms-request/index.ts',
  'register-package/index.ts',
  'register-scheduled-trip/index.ts',
  'contact-trusted-partner/index.ts',
]

/**
 * Literals that stay English on purpose. Keyed by the exact literal so a
 * reworded string has to come back through this list.
 */
const PARTNER_FACING = 'goes to another dive shop, for whom this shop’s language means nothing'

const ALLOWED = new Map<string, string>([
  // The partner half of a package recommendation (package-registration-email.ts
  // builds a partner body and a diver body; only the diver's is translated) and
  // the introduction sent to a trusted partner. Documented in docs/i18n.md.
  ['Hello from ${shopName}. We have a diver we are recommending to your shop for ', PARTNER_FACING],
  ['Please note this is an estimate only — the final cost will be determined by your shop.', PARTNER_FACING],
  ['Preferred dates: ${preferredStart} to ${preferredEnd} (${nights} night${nights === 1 ? \'\' : \'s\'})', PARTNER_FACING],
  ['Diver email: ${diverEmail} (just reply to this email to reach them directly)', PARTNER_FACING],
  ['Please let us know if we can be of further assistance.', PARTNER_FACING],
  ['Their message is below — just reply to this email to reach them directly at ${diverEmail}. ', PARTNER_FACING],
  ["We're cc'd so we can help if needed.", PARTNER_FACING],
])

/** Machine tokens and identifiers that are not prose, however word-like. */
const NON_PROSE =
  /^(?:[a-z_]+|[A-Z_]+|[\w.-]+@[\w.-]+|https?:\/\/\S*|[\w/-]+\.[a-z]{2,4}|application\/\S+|text\/\S+|[\d\s:.+-]+)$/

/**
 * Prose-looking string literals in `source`: a run of three or more words
 * starting with a capital, which is what a sentence of copy looks like and
 * what an identifier, a column list or a MIME type does not.
 *
 * Comments are stripped first — a `// the PDF's "How to pay" block` line is
 * documentation, not output.
 */
function proseLiterals(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/[^\n"'`]*$/gm, '$1')

  const found: string[] = []
  const literal = /`([^`\\]*(?:\\.[^`\\]*)*)`|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g
  for (const m of code.matchAll(literal)) {
    const value = m[1] ?? m[2] ?? m[3] ?? ''
    if (!value.trim() || NON_PROSE.test(value)) continue
    // Judge only the words the template itself contributes. `${label} ${amount}`
    // is a shape, not copy; the identifiers inside it are not what a diver reads.
    const words = value.replace(/\$\{[^}]*\}/g, ' ')
    // Three words, the first capitalised: "Signed electronically in the app".
    if (/\b[A-Z][a-z]+\b[^\n]*?\b[a-z]{2,}\b[^\n]*?\b[a-z]{2,}\b/.test(words)) found.push(value)
  }
  return found
}

describe('outbound copy comes from the message catalog', () => {
  it.each(OUTBOUND)('%s has no untranslated prose', file => {
    const source = readFileSync(join(ROOT, file), 'utf8')
    const leaked = proseLiterals(source).filter(v => !ALLOWED.has(v))

    expect(
      leaked,
      `${file} builds outbound copy from ${leaked.length} bare literal(s). ` +
      `Move each into src/i18n/messages/en.ts (plus zh-TW.ts and ja.ts) and read ` +
      `it through \`t\`, or add it to ALLOWED here with the reason it stays English.`,
    ).toEqual([])
  })

  // An allowlist entry that no longer matches any source is worse than none:
  // it reads as a live exemption while the literal it covered has been
  // reworded, moved, or already translated.
  it('has no stale allowlist entries', () => {
    const all = OUTBOUND.map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n')
    for (const [literal, reason] of ALLOWED) {
      expect(all.includes(literal), `ALLOWED entry is stale (${reason}): ${literal}`).toBe(true)
    }
  })

  it('the scan is not vacuous', () => {
    expect(proseLiterals('const a = "Signed electronically in the app"')).toEqual([
      'Signed electronically in the app',
    ])
    expect(proseLiterals('const a = `Thanks for registering your group`')).toEqual([
      'Thanks for registering your group',
    ])
    // Identifiers, column lists, MIME types and paths are not copy.
    expect(proseLiterals('from("bookings").select("id, name, notes")')).toEqual([])
    expect(proseLiterals('contentType: "application/pdf"')).toEqual([])
    expect(proseLiterals('const p = "registration.pdf"')).toEqual([])
    // A comment describing copy is documentation, not output.
    expect(proseLiterals('// the PDF prints "Included with course" here')).toEqual([])
  })
})
