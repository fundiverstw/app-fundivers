import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { personName } from '../lib/names'
import { sendPartnerConnectRequest } from '../lib/partner-connect'
import { fetchTrustedPartners, contactTrustedPartner } from '../lib/trusted-partners'
import { errorMessage } from '../lib/errors'
import type { TrustedPartner } from '../types/database'
import {
  CARD, BTN_PRIMARY, INPUT, INPUT_LABEL,
  PAGE_HEADING, PAGE_BODY, TEXT_BODY, TEXT_HEADING, TEXT_SUBTLE,
} from '../styles/tokens'

// Trusted Partners — dive shops abroad the shop vouches for. A diver can
// message one directly (the contact-trusted-partner edge function emails the
// partner from the shop address, cc's the shop, and replies-to the diver), or,
// if their destination isn't listed, ask the shop for a recommendation (the
// partner-connect edge function). Partner emails never reach the client — the
// list comes from list_trusted_partners(), which withholds them.
export function TrustedPartnersPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const [partners, setPartners] = useState<TrustedPartner[] | null>(null)
  const [destination, setDestination] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  const diverName = personName(profile?.name, profile?.nickname)

  useEffect(() => {
    let cancelled = false
    fetchTrustedPartners()
      .then(p => { if (!cancelled) setPartners(p) })
      .catch(() => { if (!cancelled) setPartners([]) })
    return () => { cancelled = true }
  }, [])

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
    <div className="max-w-xl mx-auto space-y-6">
      <div className="space-y-1">
        <h1 className={`text-xl ${PAGE_HEADING} font-bold`}>Trusted Partners</h1>
        <p className={`text-sm ${PAGE_BODY}`}>
          Dive shops abroad we've personally vetted. Message one directly — we'll
          be cc'd and help set things up.
        </p>
      </div>

      {partners && partners.length > 0 && (
        <ul className="space-y-3">
          {partners.map(p => (
            <li key={p.id}><PartnerRow partner={p} /></li>
          ))}
        </ul>
      )}

      <div className="space-y-1">
        <h2 className={`text-base ${PAGE_HEADING} font-semibold`}>Headed somewhere not listed?</h2>
        <p className={`text-sm ${PAGE_BODY}`}>
          Tell us where and we'll point you to a shop we've vetted there.
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

// One partner, with an inline compose box. The message routes through the edge
// function — the diver never sees the partner's email.
function PartnerRow({ partner }: { partner: TrustedPartner }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function send() {
    if (!message.trim() || sending) return
    setSending(true)
    try {
      await contactTrustedPartner({ partnerId: partner.id, message: message.trim() })
      setSent(true)
      toast.success(`Message sent to ${partner.name}.`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={`${CARD} p-3 space-y-2`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-sm ${TEXT_HEADING}`}>{partner.name}</p>
          {partner.region && <p className={`text-xs ${TEXT_SUBTLE}`}>{partner.region}</p>}
          {partner.blurb && <p className={`text-sm ${TEXT_BODY} mt-1`}>{partner.blurb}</p>}
        </div>
        {!sent && (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="shrink-0 text-xs font-semibold px-3 py-1 rounded-lg bg-brand-900 hover:bg-brand-950 text-white"
          >
            {open ? 'Cancel' : 'Message'}
          </button>
        )}
      </div>

      {sent ? (
        <p className="text-sm text-emerald-700 font-medium">Sent — {partner.name} will reply straight to your email.</p>
      ) : open && (
        <div className="space-y-2">
          <textarea
            aria-label={`Message to ${partner.name}`}
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={3}
            maxLength={3000}
            className={`${INPUT} resize-y`}
            placeholder={`Introduce yourself to ${partner.name} — travel dates, what you're after…`}
          />
          <button
            type="button"
            onClick={send}
            disabled={!message.trim() || sending}
            className={`w-full ${BTN_PRIMARY} disabled:opacity-50`}
          >
            {sending ? 'Sending…' : `Send to ${partner.name}`}
          </button>
        </div>
      )}
    </div>
  )
}
