import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  occurrenceDates, validateRecurrence, isoWeekday, monthPositionOf,
  MAX_OCCURRENCES, MAX_INTERVAL,
  type RecurrenceFreq, type RecurrenceRule, type Weekday,
} from '../../lib/recurrence'
import { parseIsoDate } from '../../lib/dates'
import { t } from '../../i18n'
import { TEXT_ERROR } from '../../styles/tokens'

const rc = t.admin.recurrence

// The "repeat this event" section of the create form.
//
// It reports a rule up, or null when repeating is off — the page decides between
// one insert and a batch. Everything it shows is derived from the anchor date
// the admin has already typed, so the pattern can never describe a schedule the
// event isn't on.

export interface RecurrenceFieldsProps {
  /** The date occurrence #1 falls on. Null until the form has a date, which is
   *  when repeating is offered at all. */
  anchor: string | null
  onChange: (rule: RecurrenceRule | null, label: string) => void
}

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7]

export function RecurrenceFields({ anchor, onChange }: RecurrenceFieldsProps) {
  const [enabled, setEnabled] = useState(false)
  const [freq, setFreq] = useState<RecurrenceFreq>('weekly')
  const [interval, setIntervalValue] = useState('1')
  const [weekdays, setWeekdays] = useState<Set<Weekday>>(new Set())
  const [count, setCount] = useState('4')
  const [label, setLabel] = useState('')

  const anchorWeekday = anchor ? isoWeekday(anchor) : null

  // The anchor's own weekday is always part of a weekly pattern — occurrence #1
  // is the event being filled in. Derived rather than pushed into state, so it
  // simply follows the date the admin types instead of needing an effect to
  // chase it. `weekdays` holds only the extra days they ticked.
  const selectedWeekdays = useMemo(() => {
    const next = new Set(weekdays)
    if (anchorWeekday != null) next.add(anchorWeekday)
    return next
  }, [weekdays, anchorWeekday])

  const rule = useMemo<RecurrenceRule>(() => ({
    freq,
    interval: Number(interval) || 0,
    weekdays: freq === 'weekly' ? [...selectedWeekdays].sort((a, b) => a - b) : undefined,
    count: Number(count) || 0,
  }), [freq, interval, selectedWeekdays, count])

  const problems = enabled ? validateRecurrence(rule) : []
  const dates = enabled && anchor && problems.length === 0 ? occurrenceDates(rule, anchor) : []

  useEffect(() => {
    onChange(enabled && anchor && problems.length === 0 ? rule : null, label)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, anchor, rule, label, problems.length])

  if (!anchor) {
    return (
      <div className="space-y-2">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider">{rc.heading}</h2>
        <p className="text-xs text-white/60">{rc.needsDate}</p>
      </div>
    )
  }

  function toggleWeekday(day: Weekday) {
    if (day === anchorWeekday) return
    setWeekdays(prev => {
      const next = new Set(prev)
      if (next.has(day)) next.delete(day); else next.add(day)
      return next
    })
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-bold text-white uppercase tracking-wider">{rc.heading}</h2>
      <label className="flex items-center gap-2 text-sm text-white/90 font-medium">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        {rc.enable}
      </label>

      {enabled && (
        <div className="space-y-3 bg-white/70 backdrop-blur-md border border-surface-200 rounded-md p-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs text-brand-900 font-medium mb-1">{rc.patternLabel}</span>
              <select
                value={freq}
                onChange={e => setFreq(e.target.value as RecurrenceFreq)}
                className="w-full bg-white border border-surface-300 rounded px-2 py-1.5 text-sm text-brand-900"
              >
                <option value="weekly">{rc.freqWeekly}</option>
                <option value="daily">{rc.freqDaily}</option>
                <option value="monthly_weekday">{rc.freqMonthly}</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-xs text-brand-900 font-medium mb-1">
                {rc.intervalLabel(unitFor(freq))}
              </span>
              <input
                type="number" min={1} max={MAX_INTERVAL} step={1}
                value={interval}
                onChange={e => setIntervalValue(e.target.value)}
                className="w-full bg-white border border-surface-300 rounded px-2 py-1.5 text-sm text-brand-900"
              />
            </label>
          </div>

          {freq === 'weekly' && (
            <div>
              <span className="block text-xs text-brand-900 font-medium mb-1">{rc.weekdaysLabel}</span>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map(day => {
                  const on = selectedWeekdays.has(day)
                  const locked = day === anchorWeekday
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      disabled={locked}
                      onClick={() => toggleWeekday(day)}
                      title={locked ? rc.anchorWeekdayLocked : undefined}
                      className={`px-2 py-1 rounded border text-xs font-semibold ${
                        on
                          ? 'bg-surface-700 text-white border-surface-700'
                          : 'bg-white text-brand-900 border-surface-300'
                      } ${locked ? 'opacity-70 cursor-default' : ''}`}
                    >
                      {rc.weekdayShort[day - 1]}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {freq === 'monthly_weekday' && (
            // Derived, not chosen: the anchor already says which weekday-in-month
            // this is, and showing it in words is how the admin sees that a 5th
            // Friday was read as "the last Friday".
            <p className="text-xs text-brand-900 font-medium">
              {rc.monthlyDerived(monthPositionLabel(anchor), weekdayLabel(anchor))}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs text-brand-900 font-medium mb-1">
                {rc.countLabel(MAX_OCCURRENCES)}
              </span>
              <input
                type="number" min={2} max={MAX_OCCURRENCES} step={1}
                value={count}
                onChange={e => setCount(e.target.value)}
                className="w-full bg-white border border-surface-300 rounded px-2 py-1.5 text-sm text-brand-900"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-brand-900 font-medium mb-1">{rc.labelLabel}</span>
              <input
                type="text" maxLength={120}
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder={rc.labelPlaceholder}
                className="w-full bg-white border border-surface-300 rounded px-2 py-1.5 text-sm text-brand-900"
              />
            </label>
          </div>

          {problems.length > 0 ? (
            <ul className={`text-xs space-y-0.5 ${TEXT_ERROR}`}>
              {problems.map(p => <li key={p.field}>{p.message}</li>)}
            </ul>
          ) : (
            // The dates themselves, not a description of them: these are real
            // bookable events about to be created, and the admin should see
            // exactly which days before pressing the button.
            <div>
              <p className="text-xs text-brand-900 font-semibold mb-1">{rc.previewHeading(dates.length)}</p>
              <ul className="flex flex-wrap gap-1.5">
                {dates.map((d, i) => (
                  <li
                    key={d}
                    className={`text-xs font-medium px-1.5 py-0.5 rounded border ${
                      i === 0
                        ? 'bg-surface-700 text-white border-surface-700'
                        : 'bg-white text-brand-900 border-surface-300'
                    }`}
                  >
                    {format(parseIsoDate(d), 'EEE d MMM')}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-brand-950/70 mt-1">{rc.previewNote}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function unitFor(freq: RecurrenceFreq): string {
  if (freq === 'daily') return rc.unitDays
  if (freq === 'weekly') return rc.unitWeeks
  return rc.unitMonths
}

function weekdayLabel(iso: string): string {
  return format(parseIsoDate(iso), 'EEEE')
}

function monthPositionLabel(iso: string): string {
  const position = monthPositionOf(iso)
  return position === -1 ? rc.positionLast : rc.positionOrdinal[position - 1]
}
