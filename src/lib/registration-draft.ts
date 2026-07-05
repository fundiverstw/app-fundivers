// Per-event registration draft persisted to localStorage so a diver whose
// connection drops mid-form (or who closes the tab) can resume instead of
// restarting the four-step RegisterForm. Text and selection fields only —
// picked photo files (File objects can't serialize) and the guest password
// (never persist a credential) are deliberately excluded. Cleared on a
// successful submit and auto-expired after MAX_AGE so stale personal data
// doesn't linger on a shared device.

export const REGISTRATION_DRAFT_PREFIX = 'fd_reg_draft_v1'

const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

export interface RegistrationDraft {
  savedAt: number
  step: number
  // Step 2 — diver profile
  fullName: string
  nickname: string
  dob: string
  nationality: string
  gender: string
  idNumber: string
  contactMethod: string
  contactId: string
  certAgency: string
  certLevel: string
  loggedDives: number
  nitroxCertified: boolean
  deepCertified: boolean
  emergencyName: string
  emergencyPhone: string
  guestEmail: string
  guestAgreedTerms: boolean
  // Step 3 — extras
  gearChoice: string | null
  gearHelpNote: string
  editedGearItems: string[] | null
  shoeSize: string
  heightCm: string
  weightKg: string
  roomId: string
  roomNotes: string
  addonIds: string[]
  needsTransport: boolean | null
  addNitroxCourse: boolean
  // Step 4 — payment
  payment: string
  creditCardInvoiceEmail: string
  payForEveryone: boolean
  useAccountCredit: boolean
  payDepositOnly: boolean
  notes: string
}

export interface RegistrationDraftSummary {
  key: string
  eventType: string
  eventId: string
  savedAt: number
}

// Keyed by event + booking target so a diver's draft for one dive never
// overwrites another, and a guest (no user id) gets a single per-device slot.
export function registrationDraftKey(
  eventType: string,
  eventId: string,
  targetKey: string | null,
): string {
  return `${REGISTRATION_DRAFT_PREFIX}:${eventType}:${eventId}:${targetKey ?? 'guest'}`
}

export function saveRegistrationDraft(key: string, draft: RegistrationDraft): void {
  try {
    localStorage.setItem(key, JSON.stringify(draft))
  } catch { /* storage full / unavailable (private mode) — drafting is best-effort */ }
}

export function clearRegistrationDraft(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch { /* ignore */ }
}

export function loadRegistrationDraft(key: string): RegistrationDraft | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch { return null }
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    clearRegistrationDraft(key)
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const v = parsed as Partial<RegistrationDraft>
  if (typeof v.savedAt !== 'number' || Date.now() - v.savedAt > MAX_AGE_MS) {
    clearRegistrationDraft(key)
    return null
  }
  return normalizeDraft(v)
}

// Enumerate every live draft on this device — powers the "continue where you
// left off" shortcut on the event picker. Expired / corrupt entries are
// skipped (and dropped) by loadRegistrationDraft.
export function listRegistrationDrafts(): RegistrationDraftSummary[] {
  const out: RegistrationDraftSummary[] = []
  let count: number
  try {
    count = localStorage.length
  } catch { return out }
  for (let i = 0; i < count; i++) {
    let key: string | null
    try {
      key = localStorage.key(i)
    } catch { continue }
    if (!key || !key.startsWith(`${REGISTRATION_DRAFT_PREFIX}:`)) continue
    const draft = loadRegistrationDraft(key)
    if (!draft) continue
    // key = prefix:eventType:eventId:targetKey — eventType/eventId never
    // contain a colon (kind literals + Bubble/uuid ids).
    const parts = key.split(':')
    out.push({ key, eventType: parts[1] ?? '', eventId: parts[2] ?? '', savedAt: draft.savedAt })
  }
  return out
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function bool(v: unknown): boolean {
  return v === true
}

// Defensive coercion — a corrupt or partial object (older shape, hand-edited
// storage) must never crash the form. Every field falls back to a safe empty
// value; the setters that consume it re-validate unions at apply time.
function normalizeDraft(v: Partial<RegistrationDraft>): RegistrationDraft {
  return {
    savedAt: typeof v.savedAt === 'number' ? v.savedAt : 0,
    step: typeof v.step === 'number' && v.step >= 1 && v.step <= 4 ? v.step : 1,
    fullName: str(v.fullName),
    nickname: str(v.nickname),
    dob: str(v.dob),
    nationality: str(v.nationality),
    gender: str(v.gender),
    idNumber: str(v.idNumber),
    contactMethod: str(v.contactMethod),
    contactId: str(v.contactId),
    certAgency: str(v.certAgency),
    certLevel: str(v.certLevel),
    loggedDives: typeof v.loggedDives === 'number' && Number.isFinite(v.loggedDives) ? v.loggedDives : 0,
    nitroxCertified: bool(v.nitroxCertified),
    deepCertified: bool(v.deepCertified),
    emergencyName: str(v.emergencyName),
    emergencyPhone: str(v.emergencyPhone),
    guestEmail: str(v.guestEmail),
    guestAgreedTerms: bool(v.guestAgreedTerms),
    gearChoice: typeof v.gearChoice === 'string' ? v.gearChoice : null,
    gearHelpNote: str(v.gearHelpNote),
    editedGearItems: Array.isArray(v.editedGearItems) ? v.editedGearItems.filter(x => typeof x === 'string') : null,
    shoeSize: str(v.shoeSize),
    heightCm: str(v.heightCm),
    weightKg: str(v.weightKg),
    roomId: str(v.roomId),
    roomNotes: str(v.roomNotes),
    addonIds: Array.isArray(v.addonIds) ? v.addonIds.filter(x => typeof x === 'string') : [],
    needsTransport: typeof v.needsTransport === 'boolean' ? v.needsTransport : null,
    addNitroxCourse: bool(v.addNitroxCourse),
    payment: str(v.payment),
    creditCardInvoiceEmail: str(v.creditCardInvoiceEmail),
    payForEveryone: v.payForEveryone !== false,
    useAccountCredit: v.useAccountCredit !== false,
    payDepositOnly: bool(v.payDepositOnly),
    notes: str(v.notes),
  }
}
