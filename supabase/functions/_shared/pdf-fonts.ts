// Font-selection helpers for the registration PDF. Kept apart from pdf.ts so
// vitest can import them (pdf.ts pulls in `npm:jspdf`, which Vite can't resolve).
// Same split as create-registration/handler.ts.
//
// jsPDF's built-in helvetica is a standard-14 font with WinAnsi (cp1252)
// encoding: it has no CJK glyphs and does NOT fail on them — it silently emits
// mangled bytes ("防寒衣" comes out as "–2[Òˆc"). Diver names, event titles and
// free-text notes are user-supplied, so pdf.ts embeds a TrueType CJK face and
// switches to it per string, using these predicates.

/** Characters above U+00FF that helvetica CAN still encode: the cp1252
 *  0x80–0x9F block (em dash, curly quotes, ellipsis, bullet…). */
const CP1252_EXTRAS =
  "€‚ƒ„…†‡ˆ‰Š‹Œ" +
  "Ž‘’“”•–—˜™š›œžŸ"

/** True when `text` contains a character helvetica cannot render. */
export function needsCjkFont(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp > 0xFF && !CP1252_EXTRAS.includes(ch)) return true
  }
  return false
}

/** True when any string anywhere in the payload needs the embedded face. Lets an
 *  all-Latin registration skip the ~260KB embedded font stream entirely. */
export function payloadNeedsCjkFont(payload: unknown): boolean {
  if (typeof payload === "string") return needsCjkFont(payload)
  if (Array.isArray(payload)) return payload.some(payloadNeedsCjkFont)
  if (payload && typeof payload === "object") return Object.values(payload).some(payloadNeedsCjkFont)
  return false
}
