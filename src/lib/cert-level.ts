// Divers' cert_level is partly free-text / Bubble-imported, so the same level
// shows up under several spellings — "AOW" vs "Advanced Open Water" vs
// "Advanced Open Water Diver", "OW" vs "Open Water", "RESCUE" vs "rescue
// diver", "DM" vs "Divemaster". This collapses the common families to one
// canonical label so BI panes (cert-level mix, revenue by cert) don't split a
// single cert across multiple bars. Unknown values pass through trimmed.

// Normalized key (lowercase, alphanumerics only, trailing "diver" dropped) →
// canonical display label.
const CERT_ALIASES: Record<string, string> = {
  ow: 'Open Water',
  openwater: 'Open Water',
  aow: 'Advanced Open Water',
  advancedopenwater: 'Advanced Open Water',
  rescue: 'Rescue',
  dm: 'Divemaster',
  divemaster: 'Divemaster',
}

export function canonicalCertLevel(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return ''
  let key = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '')
  // Drop a trailing "diver" so "Advanced Open Water Diver" matches "AOW".
  if (key.endsWith('diver') && key !== 'diver') key = key.slice(0, -'diver'.length)
  return CERT_ALIASES[key] ?? trimmed
}
