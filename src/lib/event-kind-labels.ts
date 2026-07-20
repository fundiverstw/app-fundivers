import { t } from '../i18n'
import type { EventKind } from './event-kinds'

// Diver-facing label and pill colour per kind. Declared as full Records so the
// compiler demands an entry for every kind — these are the surfaces where a
// missing kind would otherwise render as `undefined` in the UI. Three files
// used to keep their own copy of the label map, and two more inlined the
// `type === 'dive' ? … : …` ternary.
export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  dive:   t.calendar.typeDive,
  course: t.calendar.typeCourse,
  adventure: t.calendar.typeAdventure,
}

export const EVENT_KIND_DOT: Record<EventKind, string> = {
  dive:   'bg-emerald-600',
  course: 'bg-surface-500',
  adventure: 'bg-teal-500',
}
