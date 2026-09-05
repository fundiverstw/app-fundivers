import { useEffect, useState, type FormEvent } from 'react'
import { useToast } from '../../hooks/useToast'
import { useShopContact } from '../../hooks/useShopContact'
import { errorMessage } from '../../lib/errors'
import {
  channelLabel, channelHref, deleteContactChannel, fetchAllContactChannels,
  fetchShopContact, saveContactChannel, saveShopContact,
  type ContactChannelInput,
} from '../../lib/contact'
import { CONTACT_CHANNEL_KINDS, type ContactChannel, type ContactChannelKind } from '../../types/database'
import { ConfirmModal, FormButtons, Labelled, Modal } from '../../components/admin/listing-ui'
import { t } from '../../i18n'

const ac = t.admin.contact
const wv = t.admin.waivers

// Manage → Contact. Everything a diver uses to reach the shop, in one place:
// the details (the address mail goes to, the phone, where the shop is) and the
// ordered list of buttons the Contact tab shows.
//
// All of it used to be literals in fundive.config.ts, which meant the shop's
// own email address needed a developer, a build and a deploy to change — and
// the two chat buttons were not merely configured but HARDCODED, so a shop on
// Telegram or one that answers its phone had no way to say so.

const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

export function AdminContactPage() {
  const toast = useToast()
  // The provider feeds every diver-facing surface; refreshing it after a save
  // is what makes the change visible without a reload.
  const { refresh } = useShopContact()
  const [channels, setChannels] = useState<ContactChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ContactChannel | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<ContactChannel | null>(null)

  async function reload() {
    try {
      setChannels(await fetchAllContactChannels())
      setLoadError(null)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
    await refresh()
  }

  useEffect(() => {
    let cancelled = false
    fetchAllContactChannels()
      .then(list => { if (!cancelled) setChannels(list) })
      .catch(err => { if (!cancelled) setLoadError(errorMessage(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  async function handleDelete(channel: ContactChannel) {
    try {
      await deleteContactChannel(channel.id)
      toast.success(ac.channelDeleted)
      setConfirmDelete(null)
      await reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">{ac.title}</h1>
      <p className="text-sm text-white/80">{ac.intro}</p>

      {loadError && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{loadError}</p>
      )}

      <DetailsForm onSaved={async () => { toast.success(ac.detailsSaved); await refresh() }}
        onError={m => toast.error(m)} />

      <div className="flex items-baseline justify-between gap-3 pt-2">
        <h2 className="text-lg font-bold text-white">{ac.channelsHeading}</h2>
        <button type="button" onClick={() => setCreating(true)}
          className="text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg">
          {ac.newChannel}
        </button>
      </div>
      <p className="text-sm text-white/80">{ac.channelsIntro}</p>

      {loading ? (
        <p className="text-sm text-white/70">{wv.loading}</p>
      ) : channels.length === 0 ? (
        <p className="text-sm text-white/70">{ac.noChannels}</p>
      ) : (
        <ul className="space-y-2">
          {channels.map(channel => (
            <li key={channel.id} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-brand-900 text-sm truncate">
                  {channelLabel(channel)}
                  {/* /70 rather than /60: the contrast sweep reads 2.72:1 for
                      brand-900/60 on this card, which is under the gate. */}
                  <span className="ml-2 text-xs text-brand-900/70">{ac.kinds[channel.kind]}</span>
                  {!channel.active && <span className="ml-2 text-xs text-brand-900/70">{wv.inactive}</span>}
                </p>
                {/* The href, not the stored value: what a phone number turns
                    into is the thing worth checking before a diver taps it. */}
                <p className="text-xs text-brand-900/70 truncate">{channelHref(channel)}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => setEditing(channel)}
                  className="text-xs font-semibold bg-brand-900 hover:bg-brand-950 text-white px-3 py-1 rounded-lg">{wv.edit}</button>
                <button type="button" onClick={() => setConfirmDelete(channel)}
                  className="text-xs font-semibold bg-red-700 hover:bg-red-800 text-white px-3 py-1 rounded-lg">{wv.delete}</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <ChannelForm
          channel={editing}
          nextOrder={channels.length + 1}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={async () => {
            setCreating(false); setEditing(null)
            toast.success(ac.channelSaved)
            await reload()
          }}
          onError={m => toast.error(m)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={ac.deleteTitle}
          body={ac.deleteBody(channelLabel(confirmDelete))}
          confirmLabel={wv.delete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}
    </div>
  )
}

function DetailsForm({ onSaved, onError }: {
  onSaved: () => Promise<void>
  onError: (m: string) => void
}) {
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [mapsUrl, setMapsUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Read straight from the table rather than through the provider: this form
  // edits the row, so it wants the row, not the shape the rest of the app
  // consumes it in.
  useEffect(() => {
    let cancelled = false
    fetchShopContact().then(details => {
      if (cancelled) return
      setEmail(details.email)
      setPhone(details.phone)
      setAddress(details.address)
      setMapsUrl(details.mapsUrl ?? '')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await saveShopContact({
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
        maps_url: mapsUrl.trim() || null,
      })
      await onSaved()
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p className="text-sm text-white/70">{wv.loading}</p>

  return (
    <form onSubmit={handleSubmit} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
      <h2 className="text-sm font-bold text-brand-900">{ac.detailsHeading}</h2>
      <Labelled label={ac.emailLabel}>
        <input className={FIELD} type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder={ac.emailPh} />
      </Labelled>
      {/* Outside the label, not inside it: a hint inside becomes part of the
          field's accessible name and a screen reader reads the paragraph as
          the label. */}
      <p className="text-xs text-brand-900/70">{ac.emailHint}</p>
      <Labelled label={ac.phoneLabel}>
        <input className={FIELD} value={phone} onChange={e => setPhone(e.target.value)} placeholder={ac.phonePh} />
      </Labelled>
      <Labelled label={ac.addressLabel}>
        <input className={FIELD} value={address} onChange={e => setAddress(e.target.value)} placeholder={ac.addressPh} />
      </Labelled>
      <Labelled label={ac.mapsLabel}>
        <input className={FIELD} value={mapsUrl} onChange={e => setMapsUrl(e.target.value)} placeholder={ac.mapsPh} />
      </Labelled>
      {/* Where these turn up, so an admin can see why the field matters. */}
      <p className="text-xs text-brand-900/70">{ac.detailsUses}</p>
      <div className="flex justify-end">
        <button type="submit" disabled={submitting}
          className="text-sm font-semibold bg-brand-900 hover:bg-brand-950 text-white px-4 py-2 rounded-lg disabled:opacity-50">
          {submitting ? t.admin.catalog.saving : ac.saveDetails}
        </button>
      </div>
    </form>
  )
}

function ChannelForm({ channel, nextOrder, onClose, onSaved, onError }: {
  channel: ContactChannel | null
  nextOrder: number
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (m: string) => void
}) {
  const [kind, setKind] = useState<ContactChannelKind>(channel?.kind ?? 'line')
  const [label, setLabel] = useState(channel?.label ?? '')
  const [url, setUrl] = useState(channel?.url ?? '')
  const [sortOrder, setSortOrder] = useState(String(channel?.sort_order ?? nextOrder))
  const [active, setActive] = useState(channel?.active ?? true)
  const [submitting, setSubmitting] = useState(false)

  // Phone and SMS hold a number; everything else holds a link. The label and
  // the placeholder follow, because "URL" over a box that wants +886 909 083 683
  // is how a shop ends up with a dead button.
  const wantsNumber = kind === 'phone' || kind === 'sms'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!url.trim()) { onError(wantsNumber ? ac.numberRequired : ac.urlRequired); return }
    setSubmitting(true)
    try {
      const values: ContactChannelInput = {
        kind,
        label: label.trim() || null,
        url: url.trim(),
        sort_order: Number(sortOrder) || 0,
        active,
      }
      await saveContactChannel(values, channel?.id)
      await onSaved()
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal labelledBy="channel-form-title" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <h2 id="channel-form-title" className="text-lg font-bold text-brand-900">
          {channel ? ac.editChannel : ac.newChannelTitle}
        </h2>
        <Labelled label={ac.kindLabel}>
          <select className={FIELD} value={kind} onChange={e => setKind(e.target.value as ContactChannelKind)}>
            {CONTACT_CHANNEL_KINDS.map(k => (
              <option key={k} value={k}>{ac.kinds[k]}</option>
            ))}
          </select>
        </Labelled>
        <Labelled label={wantsNumber ? ac.numberLabel : ac.urlLabel}>
          <input className={FIELD} value={url} onChange={e => setUrl(e.target.value)}
            placeholder={wantsNumber ? ac.numberPh : ac.urlPh} />
        </Labelled>
        <p className="text-xs text-brand-900/70">{ac.urlHints[kind]}</p>
        <Labelled label={ac.labelLabel}>
          <input className={FIELD} value={label} onChange={e => setLabel(e.target.value)}
            placeholder={t.contact.channelDefaults[kind]} />
        </Labelled>
        <p className="text-xs text-brand-900/70">{ac.labelHint}</p>
        <Labelled label={ac.orderLabel}>
          <input className={FIELD} type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} />
        </Labelled>
        <label className="flex items-center gap-2 text-sm text-brand-900">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-brand-900" />
          {ac.activeLabel}
        </label>
        <FormButtons submitting={submitting} submitLabel={t.admin.catalog.saveChanges} onClose={onClose} />
      </form>
    </Modal>
  )
}
