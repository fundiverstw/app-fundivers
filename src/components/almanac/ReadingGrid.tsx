/** One record's readings as a two-column definition list. */
import { TEXT_BODY, TEXT_SUBTLE } from '../../styles/tokens'
import type { Reading } from '../../lib/almanac-readings'

export function ReadingGrid({ readings }: { readings: Reading[] }) {
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      {readings.map(({ label, value }) => (
        <div key={label} className="contents">
          <dt className={TEXT_SUBTLE}>{label}</dt>
          <dd className={TEXT_BODY}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
