import { format, parseISO } from 'date-fns'

/** Human date span for a trip card: a single day, or "d MMM – d MMM yyyy".
 *  Returns null when no start date is set. */
export function tripDateLabel(start: string | null, end: string | null): string | null {
  if (!start) return null
  const s = format(parseISO(start), 'd MMM yyyy')
  if (!end || end === start) return s
  return `${format(parseISO(start), 'd MMM')} – ${format(parseISO(end), 'd MMM yyyy')}`
}
