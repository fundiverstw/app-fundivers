import { t } from '../i18n'
import type { Profile } from '../types/database'

export type ContactMethod = NonNullable<Profile['contact_method']>

// How the diver asked to be reached. Declared as a full Record so the compiler
// demands an entry for every method — admin screens read `contact_id` next to
// this label, and a Line ID shown under an "Email" heading sends the admin to
// the wrong app.
export const CONTACT_METHOD_LABELS: Record<ContactMethod, string> = {
  whatsapp: t.profile.contactMethod.whatsapp,
  line:     t.profile.contactMethod.line,
  phone:    t.profile.contactMethod.phone,
  email:    t.profile.contactMethod.email,
}

// A diver who hasn't finished their profile has a handle but no method (or
// neither) — label it generically rather than guessing a method for them.
export function contactMethodLabel(m: ContactMethod | null | undefined): string {
  return m ? CONTACT_METHOD_LABELS[m] : t.profile.preferredContact
}
