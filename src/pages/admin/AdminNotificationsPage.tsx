import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { ERROR_NOTE_LIGHT } from '../../styles/tokens'

// Admin-only one-off broadcast. Posts the title+body to the push worker's
// /admin-broadcast endpoint, which fans out web-push to every opted-in
// device and (if BROADCAST_WEBHOOK_URL is configured) relays the same
// payload to a third-party webhook (e.g. LINE).
//
// Primary use cases: ad-hoc announcements ("trip cancelled — typhoon")
// and end-to-end smoke tests of the push pipeline when scheduled
// reminders haven't arrived as expected.

function pushWorkerUrl(): string {
  return ((import.meta.env.VITE_PUSH_WORKER_URL as string | undefined) ?? '').replace(/\/$/, '')
}

export function AdminNotificationsPage() {
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [link, setLink] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    if (!title.trim() || !body.trim()) {
      setSubmitError('Title and body are required.')
      return
    }
    const workerUrl = pushWorkerUrl()
    if (!workerUrl) {
      setSubmitError('VITE_PUSH_WORKER_URL is not configured for this environment.')
      return
    }
    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not signed in.')
      // Send url only when the admin filled it in. The worker reads
      // an empty/absent url as "no link" — push tap opens the inbox so
      // the diver can re-read the body, and the inbox row doesn't
      // render an "Open link" button.
      const trimmedLink = link.trim()
      const res = await fetch(`${workerUrl}/admin-broadcast`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          body:  body.trim(),
          ...(trimmedLink ? { url: trimmedLink } : {}),
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `Broadcast failed (HTTP ${res.status}).`)
      }
      const result = await res.json() as { sent?: number; skipped?: number; webhook?: boolean | null }
      const sent = result.sent ?? 0
      const skipped = result.skipped ?? 0
      const webhookPart = result.webhook == null
        ? ''
        : result.webhook ? ' · webhook ok' : ' · webhook failed'
      toast.success(`Sent to ${sent} device${sent === 1 ? '' : 's'}` + (skipped ? `, ${skipped} skipped` : '') + webhookPart)
      setTitle('')
      setBody('')
      setLink('')
    } catch (err) {
      setSubmitError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">One-off notification</h1>
      <p className="text-sm text-white/80">
        Sends an immediate push to every device that has notifications turned on.
        Use sparingly — every opted-in user gets it.
      </p>
      <form
        onSubmit={handleSubmit}
        className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3"
      >
        <label className="block space-y-1">
          <span className="text-xs font-medium text-brand-900">Title *</span>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Trip cancelled — typhoon"
            maxLength={80}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-brand-900">Body *</span>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="What everyone needs to know."
            rows={4}
            maxLength={1000}
            className={`${inputClass} resize-none`}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-brand-900">Link (optional)</span>
          <input
            type="text"
            value={link}
            onChange={e => setLink(e.target.value)}
            placeholder="/records/bookings  or  https://example.com"
            className={inputClass}
          />
          <span className="block text-[11px] text-brand-900/70">
            When set, tapping the push opens this URL. When empty, tapping opens the
            in-app inbox so the diver can re-read the message.
          </span>
        </label>
        {submitError && (
          <p className={ERROR_NOTE_LIGHT}>{submitError}</p>
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="py-2 px-4 rounded-lg text-sm font-semibold bg-brand-900 hover:bg-brand-950 text-white disabled:opacity-50"
          >
            {submitting ? 'Sending…' : 'Send now'}
          </button>
        </div>
      </form>
    </div>
  )
}
