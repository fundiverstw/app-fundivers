import { useState, type FormEvent } from 'react'
import {
  CARD, BTN_PRIMARY, INPUT, INPUT_LABEL,
  PAGE_HEADING, PAGE_BODY, TEXT_HEADING, TEXT_BODY, TEXT_SUBTLE,
} from '../styles/tokens'
import { useShopContact } from '../hooks/useShopContact'
import { ContactChannelButton } from '../components/contact/ContactChannelButton'
import { t } from '../i18n'

// Contact tab — entry points to reach the shop. The buttons are whatever the
// shop has set up in Manage → Contact (LINE, WhatsApp, Telegram, a phone
// number…), in the order it put them in; they used to be two hardcoded links
// with their URLs in fundive.config.ts, which meant a shop on any other service
// had no way to say so. The email "form" composes a mailto: with the subject
// and body prefilled, since the app has no backend mailer.
export function ContactPage() {
  const { contact, channels, loading } = useShopContact()
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!contact.email) return
    const params = new URLSearchParams()
    if (subject.trim()) params.set('subject', subject.trim())
    if (message.trim()) params.set('body', message.trim())
    const qs = params.toString()
    window.location.href = `mailto:${contact.email}${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="space-y-1">
        <h1 className={`text-xl ${PAGE_HEADING} font-bold`}>{t.contact.title}</h1>
        <p className={`text-sm ${PAGE_BODY}`}>
          {t.contact.intro}
        </p>
      </div>

      {/* Nothing at all while the read is in flight: an empty card that fills
          in is a card that looks broken for a moment. A shop with no channels
          set up says so, rather than showing an empty box. */}
      {!loading && (
        <div className={`${CARD} p-4 space-y-2`}>
          {channels.length === 0 ? (
            <p className={`text-xs ${TEXT_SUBTLE}`}>{t.contact.noChannels}</p>
          ) : (
            channels.map(channel => (
              <ContactChannelButton key={channel.id} channel={channel} />
            ))
          )}
        </div>
      )}

      {/* The email block goes with the address. A shop that has not published
          one has no mailto: to offer, and a form that opens a blank compose
          window is worse than no form. */}
      {!loading && contact.email && (
        <form onSubmit={handleSubmit} className={`${CARD} p-4 space-y-3`}>
          <div>
            <h2 className={`${TEXT_HEADING} text-base`}>{t.contact.emailHeading}</h2>
            <p className={`${TEXT_BODY} text-xs`}>
              {t.contact.sendsToPrefix} <span className="font-semibold">{contact.email}</span> {t.contact.sendsToSuffix}
            </p>
          </div>

          <div>
            <label htmlFor="contact-subject" className={INPUT_LABEL}>{t.contact.subject}</label>
            <input
              id="contact-subject"
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className={INPUT}
              placeholder={t.contact.subjectPlaceholder}
            />
          </div>

          <div>
            <label htmlFor="contact-message" className={INPUT_LABEL}>{t.contact.message}</label>
            <textarea
              id="contact-message"
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={6}
              className={`${INPUT} resize-y`}
              placeholder={t.contact.messagePlaceholder}
            />
          </div>

          <button type="submit" className={`w-full ${BTN_PRIMARY}`}>
            {t.contact.sendEmail}
          </button>
        </form>
      )}
    </div>
  )
}
