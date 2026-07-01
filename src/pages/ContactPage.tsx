import { useState, type FormEvent } from 'react'
import {
  CARD, BTN_PRIMARY, INPUT, INPUT_LABEL,
  PAGE_HEADING, PAGE_BODY, TEXT_HEADING, TEXT_BODY,
} from '../styles/tokens'
import { siteConfig } from '../config/site'

const LINE_URL = siteConfig.contact.lineUrl
const WHATSAPP_URL = siteConfig.contact.whatsappUrl
const SUPPORT_EMAIL = siteConfig.contact.email

// Contact tab — entry points to reach the shop. LINE / WhatsApp are
// straight handoffs to the respective apps; the email "form" composes
// a mailto: with the subject + body prefilled, since the app has no
// backend mailer (no Resend/SendGrid edge function wired up).
export function ContactPage() {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const params = new URLSearchParams()
    if (subject.trim()) params.set('subject', subject.trim())
    if (message.trim()) params.set('body', message.trim())
    const qs = params.toString()
    window.location.href = `mailto:${SUPPORT_EMAIL}${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="space-y-1">
        <h1 className={`text-xl ${PAGE_HEADING} font-bold`}>Contact</h1>
        <p className={`text-sm ${PAGE_BODY}`}>
          Reach the shop on LINE or WhatsApp, or send us an email.
        </p>
      </div>

      <div className={`${CARD} p-4 space-y-2`}>
        <a
          href={LINE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 rounded-lg px-3 py-3 bg-[#06C755] hover:bg-[#05a548] text-white font-semibold transition-colors"
        >
          <span className="flex items-center gap-3">
            <LineGlyph />
            <span>Add us on LINE</span>
          </span>
          <span aria-hidden="true">›</span>
        </a>

        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 rounded-lg px-3 py-3 bg-[#25D366] hover:bg-[#1ebe57] text-white font-semibold transition-colors"
        >
          <span className="flex items-center gap-3">
            <WhatsAppGlyph />
            <span>Message us on WhatsApp</span>
          </span>
          <span aria-hidden="true">›</span>
        </a>
      </div>

      <form onSubmit={handleSubmit} className={`${CARD} p-4 space-y-3`}>
        <div>
          <h2 className={`${TEXT_HEADING} text-base`}>Email</h2>
          <p className={`${TEXT_BODY} text-xs`}>
            Sends to <span className="font-semibold">{SUPPORT_EMAIL}</span> via
            your device's mail app.
          </p>
        </div>

        <div>
          <label htmlFor="contact-subject" className={INPUT_LABEL}>Subject</label>
          <input
            id="contact-subject"
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            className={INPUT}
            placeholder="What's this about?"
          />
        </div>

        <div>
          <label htmlFor="contact-message" className={INPUT_LABEL}>Message</label>
          <textarea
            id="contact-message"
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={6}
            className={`${INPUT} resize-y`}
            placeholder="Write your message…"
          />
        </div>

        <button type="submit" className={`w-full ${BTN_PRIMARY}`}>
          Send email
        </button>
      </form>
    </div>
  )
}

function LineGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
      <path d="M12 3C6.5 3 2 6.7 2 11.2c0 4 3.5 7.4 8.3 8 .3.1.8.2.9.5.1.3.1.7 0 1 0 0-.1.7-.2.9-.1.3-.3 1 .9.5s6.4-3.8 8.7-6.5C22.2 14 23 12.7 23 11.2 23 6.7 18 3 12 3zm-3.6 10.8H6.5c-.3 0-.5-.2-.5-.5V9.6c0-.3.2-.5.5-.5s.5.2.5.5v3.2h1.4c.3 0 .5.2.5.5s-.2.5-.5.5zm2.4 0c-.3 0-.5-.2-.5-.5V9.6c0-.3.2-.5.5-.5s.5.2.5.5v3.7c0 .3-.2.5-.5.5zm5.4 0c-.2 0-.4-.1-.5-.3l-1.9-2.6v2.4c0 .3-.2.5-.5.5s-.5-.2-.5-.5V9.6c0-.2.1-.4.4-.5.2-.1.5 0 .6.2l1.9 2.6V9.6c0-.3.2-.5.5-.5s.5.2.5.5v3.7c0 .3-.2.5-.5.5zm3.5 0H18c-.3 0-.5-.2-.5-.5V9.6c0-.3.2-.5.5-.5h1.7c.3 0 .5.2.5.5s-.2.5-.5.5h-1.2v.7h1.2c.3 0 .5.2.5.5s-.2.5-.5.5h-1.2v.7h1.2c.3 0 .5.2.5.5s-.2.5-.5.5z"/>
    </svg>
  )
}

function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
      <path d="M19.1 4.9A9.8 9.8 0 0 0 12.1 2 9.9 9.9 0 0 0 3.5 16.9L2 22l5.3-1.4a9.9 9.9 0 0 0 4.8 1.2h.1a9.9 9.9 0 0 0 9.9-9.9 9.8 9.8 0 0 0-2.9-7zm-7 15.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3a8.2 8.2 0 1 1 7 3.9zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1c-.2.2-.7.8-.8 1-.2.2-.3.2-.5.1a6.7 6.7 0 0 1-2-1.2 7.5 7.5 0 0 1-1.4-1.8c-.1-.2 0-.4.1-.5l.4-.4c.1-.1.2-.3.2-.4.1-.2 0-.3 0-.4l-.7-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3 1 2.5c.1.1 1.6 2.5 4 3.5.5.2 1 .4 1.3.5.6.2 1.1.2 1.5.1.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2 0-.1-.2-.1-.4-.2z"/>
    </svg>
  )
}
