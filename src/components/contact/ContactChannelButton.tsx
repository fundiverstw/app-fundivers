import { channelHref, channelLabel } from '../../lib/contact'
import type { ContactChannel, ContactChannelKind } from '../../types/database'

// One way into the shop, as a button.
//
// The color and the glyph come from the KIND, not from the database: divers
// recognise LINE by its green long before they read the label, and a table that
// could supply markup or a color would be either an XSS hole or a way to make
// every button look like a different app. What the shop authors is which
// services exist, where they point, and what the button says.
//
// `other` is the escape hatch and looks like the app rather than like a brand,
// which is the honest rendering: nobody's brand is being invoked.

/** Brand background and its hover, per service. Raw hex because these are other
 *  companies' colors — they are not the deployment's palette and must not drift
 *  with a theme change. */
const CHANNEL_STYLE: Record<ContactChannelKind, string> = {
  line:      'bg-[#06C755] hover:bg-[#05a548] text-white',
  whatsapp:  'bg-[#25D366] hover:bg-[#1ebe57] text-white',
  telegram:  'bg-[#229ED9] hover:bg-[#1b87ba] text-white',
  messenger: 'bg-[#0084FF] hover:bg-[#0070d8] text-white',
  instagram: 'bg-[#C13584] hover:bg-[#a52c70] text-white',
  wechat:    'bg-[#07C160] hover:bg-[#06a552] text-white',
  signal:    'bg-[#3A76F0] hover:bg-[#2f63cd] text-white',
  phone:     'bg-brand-700 hover:bg-brand-600 text-white',
  sms:       'bg-brand-700 hover:bg-brand-600 text-white',
  other:     'bg-brand-700 hover:bg-brand-600 text-white',
}

export function ContactChannelButton({ channel }: { channel: ContactChannel }) {
  const href = channelHref(channel)
  // tel: and sms: open the dialler on the device the diver is holding; a new
  // tab for those is a blank tab left behind.
  const external = channel.kind !== 'phone' && channel.kind !== 'sms'

  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={`flex items-center justify-between gap-3 rounded-lg px-3 py-3 font-semibold transition-colors ${CHANNEL_STYLE[channel.kind]}`}
    >
      <span className="flex items-center gap-3">
        <ChannelGlyph kind={channel.kind} />
        <span>{channelLabel(channel)}</span>
      </span>
      <span aria-hidden="true">›</span>
    </a>
  )
}

function ChannelGlyph({ kind }: { kind: ContactChannelKind }) {
  const path = GLYPHS[kind]
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
      <path d={path} />
    </svg>
  )
}

// One path each, drawn at 24×24. Simplified marks rather than the official
// logotypes: recognisable at 20 px, and nobody's trademark file is being
// redistributed.
const GLYPHS: Record<ContactChannelKind, string> = {
  line: 'M12 3C6.5 3 2 6.7 2 11.2c0 4 3.5 7.4 8.3 8 .3.1.8.2.9.5.1.3.1.7 0 1 0 0-.1.7-.2.9-.1.3-.3 1 .9.5s6.4-3.8 8.7-6.5C22.2 14 23 12.7 23 11.2 23 6.7 18 3 12 3zm-3.6 10.8H6.5c-.3 0-.5-.2-.5-.5V9.6c0-.3.2-.5.5-.5s.5.2.5.5v3.2h1.4c.3 0 .5.2.5.5s-.2.5-.5.5zm2.4 0c-.3 0-.5-.2-.5-.5V9.6c0-.3.2-.5.5-.5s.5.2.5.5v3.7c0 .3-.2.5-.5.5zm5.4 0c-.2 0-.4-.1-.5-.3l-1.9-2.6v2.4c0 .3-.2.5-.5.5s-.5-.2-.5-.5V9.6c0-.2.1-.4.4-.5.2-.1.5 0 .6.2l1.9 2.6V9.6c0-.3.2-.5.5-.5s.5.2.5.5v3.7c0 .3-.2.5-.5.5zm3.5 0H18c-.3 0-.5-.2-.5-.5V9.6c0-.3.2-.5.5-.5h1.7c.3 0 .5.2.5.5s-.2.5-.5.5h-1.2v.7h1.2c.3 0 .5.2.5.5s-.2.5-.5.5h-1.2v.7h1.2c.3 0 .5.2.5.5s-.2.5-.5.5z',
  whatsapp: 'M19.1 4.9A9.8 9.8 0 0 0 12.1 2 9.9 9.9 0 0 0 3.5 16.9L2 22l5.3-1.4a9.9 9.9 0 0 0 4.8 1.2h.1a9.9 9.9 0 0 0 9.9-9.9 9.8 9.8 0 0 0-2.9-7zm-7 15.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3a8.2 8.2 0 1 1 7 3.9zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1c-.2.2-.7.8-.8 1-.2.2-.3.2-.5.1a6.7 6.7 0 0 1-2-1.2 7.5 7.5 0 0 1-1.4-1.8c-.1-.2 0-.4.1-.5l.4-.4c.1-.1.2-.3.2-.4.1-.2 0-.3 0-.4l-.7-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3 1 2.5c.1.1 1.6 2.5 4 3.5.5.2 1 .4 1.3.5.6.2 1.1.2 1.5.1.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2 0-.1-.2-.1-.4-.2z',
  telegram: 'M21.9 4.4 18.7 19c-.2 1-.9 1.3-1.7.8l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.8 8.8-8c.4-.3-.1-.5-.6-.2L6.6 12.9l-4.7-1.5c-1-.3-1-1 .2-1.5l18.4-7.1c.9-.3 1.6.2 1.4 1.6z',
  messenger: 'M12 2C6.4 2 2 6.1 2 11.6c0 3.1 1.4 5.9 3.7 7.7v3.8l3.4-1.9c.9.3 1.9.4 2.9.4 5.6 0 10-4.1 10-9.6S17.6 2 12 2zm1 12.9-2.6-2.7-5 2.7 5.5-5.8 2.6 2.7 4.9-2.7-5.4 5.8z',
  instagram: 'M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.3 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.3 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.3 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .3-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.3-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.3-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.3-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.3 2.2-.4 1.3-.1 1.7-.1 4.8-.1zm0 3.8a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm0 9.9a3.9 3.9 0 1 1 0-7.8 3.9 3.9 0 0 1 0 7.8zm7.6-10.1a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0z',
  wechat: 'M8.7 4C4.9 4 1.8 6.6 1.8 9.8c0 1.8 1 3.4 2.6 4.5l-.6 2 2.3-1.2c.8.2 1.7.4 2.6.4h.6a5.3 5.3 0 0 1-.2-1.5c0-3 2.9-5.4 6.5-5.4h.6C15.6 5.9 12.5 4 8.7 4zM6.4 8.3a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zm4.6 0a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zm11.2 5.7c0-2.6-2.6-4.7-5.8-4.7s-5.8 2.1-5.8 4.7 2.6 4.7 5.8 4.7c.7 0 1.4-.1 2-.3l1.9 1-.5-1.7c1.5-.9 2.4-2.2 2.4-3.7zm-7.7-.8a.8.8 0 1 1 0-1.5.8.8 0 0 1 0 1.5zm3.8 0a.8.8 0 1 1 0-1.5.8.8 0 0 1 0 1.5z',
  signal: 'M12 2a10 10 0 0 0-8.6 15.1L2 22l4.9-1.4A10 10 0 1 0 12 2zm0 2a8 8 0 1 1-4.2 14.8l-.4-.2-2.5.7.7-2.4-.2-.4A8 8 0 0 1 12 4z',
  phone: 'M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.2.4 2.4.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .7-.2 1l-2.3 2.2z',
  sms: 'M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM7 11a1.2 1.2 0 1 1 0-2.5A1.2 1.2 0 0 1 7 11zm5 0a1.2 1.2 0 1 1 0-2.5A1.2 1.2 0 0 1 12 11zm5 0a1.2 1.2 0 1 1 0-2.5A1.2 1.2 0 0 1 17 11z',
  other: 'M10.6 13.4a1 1 0 0 1 0-1.4l2-2a1 1 0 0 1 1.4 0 1 1 0 0 0 1.4-1.4 3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2 1 1 0 0 0-1.4-1.4 1 1 0 0 1-1.4 0zm7.8-7.8a5 5 0 0 0-7 0l-1.5 1.4a1 1 0 0 0 1.4 1.4l1.5-1.4a3 3 0 0 1 4.2 4.2l-1.4 1.5a1 1 0 0 0 1.4 1.4l1.4-1.5a5 5 0 0 0 0-7zM8.7 15.9l-1.5 1.4a3 3 0 0 1-4.2-4.2l1.4-1.5a1 1 0 0 0-1.4-1.4l-1.4 1.5a5 5 0 0 0 7 7l1.5-1.4a1 1 0 0 0-1.4-1.4z',
}
