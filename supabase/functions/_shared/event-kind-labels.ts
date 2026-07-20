// Event-kind labels for the Deno edge-function runtime.
//
// Mirrors src/lib/event-kind-labels.ts, which cannot be reused here for the
// same reason _shared/i18n.ts exists: the app-side module reaches src/i18n,
// which pulls in src/config/site.ts and its extensionless config specifier.
// The kind vocabulary itself is shared — src/lib/event-kinds.ts is
// deliberately import-free so both runtimes can load it.
//
// A full Record, so adding a kind forces a label rather than letting an email
// fall back to a hardcoded "Course".

import { t } from "./i18n.ts"
import type { EventKind } from "../../../src/lib/event-kinds.ts"

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  dive:   t.calendar.typeDive,
  course: t.calendar.typeCourse,
}
