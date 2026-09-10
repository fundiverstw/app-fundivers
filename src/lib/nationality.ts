// Divers type their own nationality, so one country arrives under several
// names: "USA", "US", "United States", "American". Left alone that splits a
// single country across several bars on the BI panes and several rows on the
// boat manifest.
//
// Canonical form is the English country name. Both the country and the demonym
// are accepted, because the field has always taken either and the historical
// data holds both.
//
// Import-free on purpose: the Deno edge functions build the manifest from this
// same table (see supabase/functions/_shared/event-divers-manifest.ts).

/** Canonical country → every spelling seen in the wild, canonical included. */
const COUNTRY_ALIASES: Record<string, readonly string[]> = {
  'Taiwan': ['taiwan', 'taiwanese', 'roc', 'r.o.c.', 'republic of china', 'tw', 'formosa'],
  'United States': ['usa', 'us', 'u.s.', 'u.s.a.', 'united states', 'united states of america', 'america', 'american'],
  'United Kingdom': ['uk', 'u.k.', 'united kingdom', 'britain', 'great britain', 'british', 'england', 'english', 'gb', 'scotland', 'scottish', 'wales', 'welsh'],
  'Ireland': ['ireland', 'irish', 'eire'],
  'China': ['china', 'chinese', 'prc', "people's republic of china", 'cn'],
  'Hong Kong': ['hong kong', 'hongkong', 'hk', 'hongkonger'],
  'Macau': ['macau', 'macao'],
  'Japan': ['japan', 'japanese', 'jp', 'nippon'],
  'South Korea': ['korea', 'south korea', 'korean', 'republic of korea', 'kr'],
  'Canada': ['canada', 'canadian', 'ca'],
  'Australia': ['australia', 'australian', 'aussie', 'au'],
  'New Zealand': ['new zealand', 'newzealand', 'kiwi', 'nz'],
  'Germany': ['germany', 'german', 'deutschland', 'de'],
  'France': ['france', 'french', 'fr'],
  'Italy': ['italy', 'italian', 'it'],
  'Spain': ['spain', 'spanish', 'espana', 'es'],
  'Portugal': ['portugal', 'portuguese', 'pt'],
  'Netherlands': ['netherlands', 'dutch', 'holland', 'nl'],
  'Belgium': ['belgium', 'belgian', 'be'],
  'Switzerland': ['switzerland', 'swiss', 'ch'],
  'Austria': ['austria', 'austrian', 'at'],
  'Poland': ['poland', 'polish', 'pl'],
  'Czechia': ['czechia', 'czech', 'czech republic', 'cz'],
  'Croatia': ['croatia', 'croatian', 'hr'],
  'Sweden': ['sweden', 'swedish', 'se'],
  'Norway': ['norway', 'norwegian', 'no'],
  'Denmark': ['denmark', 'danish', 'dk'],
  'Finland': ['finland', 'finnish', 'fi'],
  'Russia': ['russia', 'russian', 'ru'],
  'Ukraine': ['ukraine', 'ukrainian', 'ua'],
  'Israel': ['israel', 'israeli', 'il'],
  'Turkey': ['turkey', 'turkish', 'turkiye', 'tr'],
  'South Africa': ['south africa', 'south african', 'za'],
  'Mexico': ['mexico', 'mexican', 'mx'],
  'Brazil': ['brazil', 'brazilian', 'brasil', 'br'],
  'Argentina': ['argentina', 'argentinian', 'argentine', 'ar'],
  'Chile': ['chile', 'chilean', 'cl'],
  'Philippines': ['philippines', 'filipino', 'filipina', 'ph'],
  'Malaysia': ['malaysia', 'malaysian', 'my'],
  'Singapore': ['singapore', 'singaporean', 'sg'],
  'Indonesia': ['indonesia', 'indonesian', 'id'],
  'Thailand': ['thailand', 'thai', 'th'],
  'Vietnam': ['vietnam', 'vietnamese', 'viet nam', 'vn'],
  'India': ['india', 'indian', 'in'],
  'Nepal': ['nepal', 'nepali', 'nepalese'],
}

/** Canonical country → Chinese name, for the Taiwanese boat manifest. */
export const COUNTRY_ZH: Record<string, string> = {
  'Taiwan': '台灣',
  'United States': '美國',
  'United Kingdom': '英國',
  'Ireland': '愛爾蘭',
  'China': '中國',
  'Hong Kong': '香港',
  'Macau': '澳門',
  'Japan': '日本',
  'South Korea': '韓國',
  'Canada': '加拿大',
  'Australia': '澳洲',
  'New Zealand': '紐西蘭',
  'Germany': '德國',
  'France': '法國',
  'Italy': '義大利',
  'Spain': '西班牙',
  'Portugal': '葡萄牙',
  'Netherlands': '荷蘭',
  'Belgium': '比利時',
  'Switzerland': '瑞士',
  'Austria': '奧地利',
  'Poland': '波蘭',
  'Czechia': '捷克',
  'Croatia': '克羅埃西亞',
  'Sweden': '瑞典',
  'Norway': '挪威',
  'Denmark': '丹麥',
  'Finland': '芬蘭',
  'Russia': '俄羅斯',
  'Ukraine': '烏克蘭',
  'Israel': '以色列',
  'Turkey': '土耳其',
  'South Africa': '南非',
  'Mexico': '墨西哥',
  'Brazil': '巴西',
  'Argentina': '阿根廷',
  'Chile': '智利',
  'Philippines': '菲律賓',
  'Malaysia': '馬來西亞',
  'Singapore': '新加坡',
  'Indonesia': '印尼',
  'Thailand': '泰國',
  'Vietnam': '越南',
  'India': '印度',
  'Nepal': '尼泊爾',
}

/** Every country this module can canonicalize onto. */
export const CANONICAL_COUNTRIES = Object.keys(COUNTRY_ALIASES)

/** Lowercased, punctuation and spacing removed: "U.S.A." and "usa" agree. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '')
}

const BY_ALIAS: Record<string, string> = {}
for (const [country, aliases] of Object.entries(COUNTRY_ALIASES)) {
  BY_ALIAS[normalize(country)] = country
  for (const alias of aliases) BY_ALIAS[normalize(alias)] = country
}

/**
 * The canonical English country name for a free-text nationality.
 *
 * Anything unrecognized comes back trimmed but otherwise untouched — a country
 * we have no alias for is still a real answer, and quietly folding it into
 * "Other" would hide a diver the admin could correct.
 */
export function canonicalNationality(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return ''
  return BY_ALIAS[normalize(trimmed)] ?? trimmed
}

/** The Chinese country name for the manifest, falling back to the raw value. */
export function nationalityToZh(raw: string | null | undefined): string {
  const canonical = canonicalNationality(raw)
  if (!canonical) return ''
  return COUNTRY_ZH[canonical] ?? canonical
}
