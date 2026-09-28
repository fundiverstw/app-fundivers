import { useState } from 'react'
import { Link } from 'react-router-dom'
import { personName } from '../../lib/names'
import { gearPackList } from '../../lib/gear'
import { shoeAsJp } from '../../lib/shoe-size'
import { packProgress, type PackPiece } from '../../lib/pack-list'
import { AdminNotes } from './AdminNotes'
import { GearSizeEditor } from './GearSizeEditor'
import type { DiverGearRow } from './DiverGearCard'
import type { GearModelWithSizes } from '../../lib/gear-sizing'
import type { Profile } from '../../types/database'
import { BTN_XS_BASE, BTN_XS_GHOST } from '../../styles/tokens'
import { t } from '../../i18n'

const gc = t.admin.gearCard
const pk = t.admin.logistics.pack

/**
 * One guest on the day's pack list: every piece the shop brings for them, each
 * a big toggle that flips green as it goes on the van. The guest's name sits on
 * top of their own pieces, so nothing can be packed without knowing whose it
 * is, and a guest with anything left unticked is visibly unfinished.
 *
 * Once every piece is ticked the card folds to a single green line, so the
 * list shrinks as the van fills and what is left to do stays at eye level.
 */
export function GuestPackCard({
  row, pieces, packed, onToggle, onSetAll, linkToProfile = false, gearModels, onProfilePatched,
}: {
  row: DiverGearRow
  pieces: PackPiece[]
  packed: Set<string>
  onToggle: (key: string) => void
  onSetAll: (keys: string[], value: boolean) => void
  // The People card is admin-only, so the caller decides whether to link.
  linkToProfile?: boolean
  gearModels?: GearModelWithSizes[]
  onProfilePatched: (diverId: string, patch: Partial<Profile>) => void
}) {
  const { booking, profile } = row
  const name = personName(profile?.name) || gc.unknown
  const pack = gearPackList(booking)
  const { packed: done, total } = packProgress(pieces, packed)
  const allDone = total > 0 && done === total
  const [peek, setPeek] = useState(false)
  const [sizesOpen, setSizesOpen] = useState(false)
  const missingSize = pieces.some(p => p.sizeMissing)

  if (allDone && !peek) {
    return (
      <article
        aria-label={name}
        className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 flex items-center justify-between gap-3"
      >
        <p className="min-w-0 text-sm font-semibold text-emerald-100 break-words">
          <span aria-hidden>✓ </span>{name}
          <span className="font-medium text-emerald-200/80"> · {pk.allPackedCount(total)}</span>
        </p>
        <button type="button" onClick={() => setPeek(true)} aria-label={pk.showGuest(name)} className={`shrink-0 ${BTN_XS_GHOST}`}>
          {pk.show}
        </button>
      </article>
    )
  }

  const shoe = profile?.shoe_size ? (shoeAsJp(profile.shoe_size) ?? profile.shoe_size) : null
  const measures = [
    profile?.height_cm && `${profile.height_cm}cm`,
    profile?.weight_kg && `${profile.weight_kg}kg`,
    shoe && pk.shoe(shoe),
  ].filter(Boolean).join(' · ')

  return (
    <article aria-label={name} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-2.5 sm:p-3 space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-brand-900 break-words">
              {linkToProfile && profile ? (
                <Link to={`/admin/users?diver=${profile.id}`} className="hover:underline">{name}</Link>
              ) : name}
            </h3>
            {booking.status === 'waitlisted' && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-300 font-semibold shrink-0">
                {gc.waitlisted}
              </span>
            )}
          </div>
          {total > 0 && (
            <p className={`text-xs font-semibold ${done > 0 ? 'text-amber-300' : 'text-brand-100/70'}`}>
              {pk.guestProgress(done, total)}
            </p>
          )}
        </div>
        {total > 1 && (
          <div className="flex shrink-0 gap-1.5">
            {allDone && (
              <button type="button" onClick={() => setPeek(false)} className={BTN_XS_GHOST}>{pk.hide}</button>
            )}
            <button
              type="button"
              onClick={() => onSetAll(pieces.map(p => p.key), !allDone)}
              aria-label={allDone ? gc.unmarkAllPacked(name) : gc.markAllPacked(name)}
              className={BTN_XS_GHOST}
            >
              {allDone ? pk.unpackAll : pk.packAll}
            </button>
          </div>
        )}
      </header>

      {pack.note && (
        <p className="text-sm text-red-900 bg-red-50 border border-red-300 rounded-lg p-2 whitespace-pre-wrap">
          <span className="font-semibold">{pk.needsHelp} </span>{pack.note}
        </p>
      )}

      {pieces.length > 0 && (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-2">
          {pieces.map(p => (
            <li key={p.key}>
              <PieceToggle piece={p} guest={name} isPacked={packed.has(p.key)} onToggle={() => onToggle(p.key)} />
            </li>
          ))}
        </ul>
      )}

      {profile && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setSizesOpen(o => !o)}
            aria-expanded={sizesOpen}
            aria-label={pk.sizesFor(name)}
            className={missingSize
              ? `${BTN_XS_BASE} border border-amber-400/60 text-amber-200 hover:bg-amber-500/10`
              : BTN_XS_GHOST}
          >
            {missingSize ? pk.addMissingSize : pk.sizes}
          </button>
          {sizesOpen && (
            <div className="rounded-lg border border-white/15 p-2 space-y-2">
              {measures && <p className="text-xs text-brand-100/70 font-medium">{measures}</p>}
              <GearSizeEditor profile={profile} packItems={pack.items} gearModels={gearModels} onProfilePatched={onProfilePatched} />
            </div>
          )}
        </div>
      )}

      <AdminNotes target={{ kind: 'booking', id: booking.id }} tagFilter="gear" title={gc.gearFlags} compact />
    </article>
  )
}

/** One piece: a thumb-sized toggle reading the item, and under it the one
 *  thing a packer needs to pull the right one — its size, or why it's special. */
function PieceToggle({ piece, guest, isPacked, onToggle }: {
  piece: PackPiece
  guest: string
  isPacked: boolean
  onToggle: () => void
}) {
  const label = piece.size ? `${piece.item} ${piece.size}` : piece.item
  const notes = [
    piece.size && pk.size(piece.size),
    piece.sizeMissing && pk.sizeMissing,
    piece.kind === 'care' && t.admin.groups.handleWithCare,
    piece.kind === 'extra' && pk.addOn,
    piece.owned && pk.ownsOne,
  ].filter((x): x is string => !!x)
  const tone = isPacked
    ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-50'
    : piece.kind === 'care'
      ? 'border-amber-400/60 bg-amber-500/10 text-amber-50 hover:border-amber-300'
      : 'border-white/25 bg-white/5 text-brand-50 hover:border-white/50'
  const noteTone = isPacked
    ? 'text-emerald-200'
    : piece.sizeMissing
      ? 'text-amber-300'
      : piece.kind === 'care' ? 'text-amber-200' : 'text-brand-100/70'
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isPacked}
      aria-label={isPacked ? gc.unmarkItemPacked(guest, label) : gc.markItemPacked(guest, label)}
      className={`w-full h-full min-h-12 flex items-center gap-2 rounded-lg border px-2 sm:px-2.5 py-2 text-left transition-colors ${tone}`}
    >
      <span
        aria-hidden
        className={`shrink-0 size-5 rounded-full border-2 flex items-center justify-center text-xs font-bold ${
          isPacked ? 'border-emerald-300 bg-emerald-400 text-slate-950' : 'border-white/40'
        }`}
      >
        {isPacked ? '✓' : ''}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold break-words">{piece.item}</span>
        {notes.length > 0 && (
          <span className={`block text-xs font-medium break-words ${noteTone}`}>{notes.join(' · ')}</span>
        )}
      </span>
    </button>
  )
}
