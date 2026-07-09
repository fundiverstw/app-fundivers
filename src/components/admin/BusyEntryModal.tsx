import { useState, type FormEvent } from 'react'
import {
  createStaffAvailability, updateStaffAvailability, deleteStaffAvailability,
} from '../../lib/staff-availability'
import type { StaffBusyEntry } from '../../types/database'
import { DateField } from '../DateField'
import {
  MODAL_BACKDROP, MODAL_PANEL, INPUT, INPUT_LABEL,
  BTN_PRIMARY, BTN_DANGER, TEXT_HEADING, TEXT_BODY, TEXT_ERROR,
} from '../../styles/tokens'
import { t } from '../../i18n'

const bz = t.admin.busy

interface CreateProps {
  mode: 'create'
  userId: string
  defaultDate: string  // YYYY-MM-DD prefilled into start_date + end_date
  onClose: () => void
  onSaved: (row: StaffBusyEntry) => void
}

interface EditProps {
  mode: 'edit'
  // The edit modal is only opened for the viewer's own rows, so title /
  // details are present (not masked); the type still allows null so the
  // shape matches the view projection on the way in.
  entry: StaffBusyEntry
  canDelete: boolean  // own row only
  onClose: () => void
  onSaved: (row: StaffBusyEntry) => void
  onDeleted: (id: string) => void
}

export type BusyEntryModalProps = CreateProps | EditProps

export function BusyEntryModal(props: BusyEntryModalProps) {
  const editing = props.mode === 'edit'
  const initial = editing ? props.entry : null

  const [startDate, setStartDate] = useState(initial?.start_date ?? (props.mode === 'create' ? props.defaultDate : ''))
  // Default 09:00 to keep the picker out of midnight which is rarely what people mean.
  const [startTime, setStartTime] = useState(initial?.start_time?.slice(0, 5) ?? '09:00')
  const [endDate, setEndDate]     = useState(initial?.end_date   ?? (props.mode === 'create' ? props.defaultDate : ''))
  const [title, setTitle]         = useState(initial?.title      ?? '')
  const [details, setDetails]     = useState(initial?.details    ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!title.trim()) { setError(bz.titleRequired); return }
    if (endDate < startDate) { setError(bz.endBeforeStart); return }
    setSubmitting(true)
    try {
      if (props.mode === 'create') {
        const row = await createStaffAvailability({
          user_id: props.userId,
          start_date: startDate,
          start_time: startTime,
          end_date: endDate,
          title: title.trim(),
          details: details.trim() || null,
        })
        props.onSaved(row)
      } else {
        const row = await updateStaffAvailability(props.entry.id, {
          start_date: startDate,
          start_time: startTime,
          end_date: endDate,
          title: title.trim(),
          details: details.trim() || null,
        })
        props.onSaved(row)
      }
    } catch (err) {
      setError((err as Error).message ?? bz.couldNotSave)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    if (props.mode !== 'edit') return
    if (!window.confirm(bz.confirmDelete)) return
    setSubmitting(true)
    try {
      await deleteStaffAvailability(props.entry.id)
      props.onDeleted(props.entry.id)
    } catch (err) {
      setError((err as Error).message ?? bz.couldNotDelete)
      setSubmitting(false)
    }
  }

  return (
    <div className={MODAL_BACKDROP} onClick={props.onClose}>
      <div className="flex items-start justify-center px-4 pt-8 pb-4 h-full overflow-y-auto">
        <form
          onSubmit={handleSubmit}
          onClick={e => e.stopPropagation()}
          className={`${MODAL_PANEL} w-full max-w-md p-6 space-y-4`}
        >
          <div className="flex items-start justify-between">
            <div>
              <h2 className={`${TEXT_HEADING} text-lg`}>{editing ? bz.editTitle : bz.createTitle}</h2>
              <p className={`${TEXT_BODY} text-xs`}>
                Periods you're not available for duties.
              </p>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              className="text-brand-900 hover:text-red-700 text-xl leading-none"
              aria-label={bz.close}
            >×</button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="busy-start-date" className={INPUT_LABEL}>{bz.startDate}</label>
              <DateField
                id="busy-start-date" required
                value={startDate} onChange={setStartDate}
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor="busy-start-time" className={INPUT_LABEL}>{bz.startTime}</label>
              <input
                id="busy-start-time" type="time" required
                value={startTime} onChange={e => setStartTime(e.target.value)}
                className={INPUT}
              />
            </div>
          </div>

          <div>
            <label htmlFor="busy-end-date" className={INPUT_LABEL}>{bz.endDate}</label>
            <DateField
              id="busy-end-date" required
              value={endDate} onChange={setEndDate}
              min={startDate || undefined}
              className={INPUT}
            />
          </div>

          <div>
            <label htmlFor="busy-title" className={INPUT_LABEL}>{bz.titleLabel}</label>
            <input
              id="busy-title" type="text" required maxLength={200}
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder={bz.titlePlaceholder}
              className={INPUT}
            />
          </div>

          <div>
            <label htmlFor="busy-details" className={INPUT_LABEL}>{bz.details}</label>
            <textarea
              id="busy-details" rows={4} maxLength={2000}
              value={details} onChange={e => setDetails(e.target.value)}
              className={`${INPUT} resize-y`}
            />
          </div>

          {error && <p className={`${TEXT_ERROR} text-sm`}>{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            {editing && props.canDelete && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={submitting}
                className={`px-3 ${BTN_DANGER}`}
              >{bz.delete}</button>
            )}
            <button
              type="submit" disabled={submitting}
              className={`flex-1 ${BTN_PRIMARY}`}
            >{submitting ? bz.submitting : editing ? bz.saveChanges : bz.markBusy}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
