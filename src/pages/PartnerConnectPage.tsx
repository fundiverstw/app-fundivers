import { useState, type FormEvent } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { personName } from '../lib/names'
import { sendPartnerConnectRequest } from '../lib/partner-connect'
import { errorMessage } from '../lib/errors'
import {
  CARD, BTN_PRIMARY, INPUT, INPUT_LABEL,
  PAGE_HEADING, PAGE_BODY, TEXT_BODY,
} from '../styles/tokens'

// Partner Connect (PX) — a diver tells us where they're headed and we
// reply with a dive shop we've personally vetted there. The form emails
// the shop inbox via the partner-connect edge function.
export function PartnerConnectPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const [destination, setDestination] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  const diverName = personName(profile?.name, profile?.nickname)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!destination.trim() || submitting) return
    setSubmitting(true)
    try {
      await sendPartnerConnectRequest({ destination: destination.trim(), note: note.trim() })
      setSent(true)
      toast.success('Request sent — we\'ll be in touch.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="space-y-1">
        <h1 className={`text-xl ${PAGE_HEADING} font-bold`}>Partner Connect <span className="opacity-70">(PX)</span></h1>
        <p className={`text-sm ${PAGE_BODY}`}>
          Heading somewhere to dive? Tell us where and we'll point you to a
          dive shop we've personally vetted there.
        </p>
      </div>

      {sent ? (
        <div className={`${CARD} p-4 space-y-3`}>
          <p className={`${TEXT_BODY}`}>
            Thanks{diverName ? `, ${diverName}` : ''}! We got your request for{' '}
            <span className="font-semibold">{destination.trim()}</span> and will
            get back to you with a recommendation.
          </p>
          <button
            type="button"
            onClick={() => { setSent(false); setDestination(''); setNote('') }}
            className={`w-full ${BTN_PRIMARY}`}
          >
            Send another
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className={`${CARD} p-4 space-y-3`}>
          <div>
            <label htmlFor="px-destination" className={INPUT_LABEL}>Where do you want to go?</label>
            <input
              id="px-destination"
              type="text"
              value={destination}
              onChange={e => setDestination(e.target.value)}
              className={INPUT}
              placeholder="e.g. Cebu, Philippines"
              maxLength={200}
              required
            />
          </div>

          <div>
            <label htmlFor="px-note" className={INPUT_LABEL}>Anything else? <span className="font-normal opacity-70">(optional)</span></label>
            <textarea
              id="px-note"
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={4}
              className={`${INPUT} resize-y`}
              placeholder="Travel dates, what kind of diving you're after, group size…"
              maxLength={2000}
            />
          </div>

          <button type="submit" disabled={!destination.trim() || submitting} className={`w-full ${BTN_PRIMARY} disabled:opacity-50`}>
            {submitting ? 'Sending…' : 'Send request'}
          </button>
        </form>
      )}
    </div>
  )
}
