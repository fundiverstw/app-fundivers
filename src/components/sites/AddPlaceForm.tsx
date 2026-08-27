/**
 * Adding a place to the catalog, from a diver surface.
 *
 * The catalog used to be admin-only, so a diver who had dived somewhere the
 * shop had not entered had nowhere to file what they saw. Now they can add it
 * — and this form's real job is to make sure that, most of the time, they do
 * not have to: it searches every name of every place in every language as they
 * type, and offers what it finds before a new row is written.
 *
 * The suggestions are a warning, not a wall. Iron House 2 and Iron House /
 * Iron Reef are both real, a hundred metres apart, and a diver who was there
 * knows which one they mean better than a trigram does. What the friction is
 * for is the other case — the person typing "Batcave" because they could not
 * find Bat Cave — so when there are matches the confirm button says so.
 */
import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import {
  findSimilarDiveSites, createDiveSite, siteName, otherSiteNames, type SimilarSite,
} from '../../lib/dive-sites'
import { numOrNull } from '../../lib/num'
import { errorMessage } from '../../lib/errors'
import type { SiteKind } from '../../types/database'
import {
  INPUT, INPUT_LABEL, BTN_PRIMARY, BTN_SECONDARY, BTN_XS_PRIMARY,
  TEXT_BODY, TEXT_HEADING, TEXT_SUBTLE, ERROR_NOTE_LIGHT, CARD,
} from '../../styles/tokens'

/** Long enough that the list is not rewritten mid-word, short enough that it
 *  is on screen before the diver reaches for the button. */
const SEARCH_DEBOUNCE_MS = 350

interface Props {
  kind: SiteKind
  /** Prefills the name they had already typed while looking for the place. */
  initialName?: string
  onAdded: (siteId: string) => void
  onCancel: () => void
  /** Offered instead of adding, when the search found the place already. */
  onPick: (siteId: string) => void
}

export function AddPlaceForm({ kind, initialName = '', onAdded, onCancel, onPick }: Props) {
  const s = t.sites
  const [name, setName] = useState(initialName)
  const [nameZh, setNameZh] = useState('')
  const [nameJa, setNameJa] = useState('')
  const [region, setRegion] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [matches, setMatches] = useState<SimilarSite[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Every name they have given, so a diver who types only a Chinese name is
  // warned about the row whose English name matches just as surely as the
  // diver who types "Batcave".
  const typed = [name, nameZh, nameJa].map(n => n.trim()).filter(n => n.length >= 2)
  const searchKey = typed.join(' ')
  const latest = useRef(0)

  useEffect(() => {
    const terms = searchKey ? searchKey.split(' ').filter(Boolean) : []
    // Nothing to search: leave the state alone and let `shown` below hide what
    // is in it. Clearing it here would be a setState straight out of an effect
    // for a value the render can derive.
    if (terms.length === 0) return
    const run = ++latest.current
    const timer = setTimeout(async () => {
      try {
        const found = await Promise.all(terms.map(n => findSimilarDiveSites(n, kind)))
        if (latest.current !== run) return
        // One entry per place, keeping the best score any of the names scored.
        const best = new Map<string, SimilarSite>()
        for (const hit of found.flat()) {
          const seen = best.get(hit.id)
          if (!seen || hit.score > seen.score) best.set(hit.id, hit)
        }
        setMatches([...best.values()].sort((a, b) => b.score - a.score))
      } catch {
        // A failed search must not block adding the place. The diver came here
        // to file an observation; losing the suggestion is a smaller harm than
        // losing the form.
        if (latest.current === run) setMatches([])
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchKey, kind])

  async function submit() {
    if (!name.trim()) { setError(s.nameRequired); return }
    const lat = numOrNull(latitude)
    const lon = numOrNull(longitude)
    if ((lat === null) !== (lon === null)) { setError(s.coordsBoth); return }
    setSubmitting(true)
    setError(null)
    try {
      const id = await createDiveSite({
        name, kind,
        name_zh_tw: nameZh, name_ja: nameJa, region,
        latitude: lat, longitude: lon,
      })
      onAdded(id)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  // Matches belong to the name that was typed. When the fields are emptied the
  // suggestions go with them, whatever the last search left behind.
  const shown = typed.length === 0 ? [] : matches

  return (
    <div className="space-y-3">
      <div>
        <h3 className={`text-sm ${TEXT_HEADING}`}>{s.addHeading}</h3>
        <p className={`text-xs ${TEXT_SUBTLE}`}>{s.addBlurb}</p>
      </div>

      <label className="block">
        <span className={INPUT_LABEL}>{s.nameEn}</span>
        <input className={INPUT} value={name} onChange={e => setName(e.target.value)} placeholder={s.nameEnPh} />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={INPUT_LABEL}>{s.nameZh}</span>
          <input className={INPUT} value={nameZh} onChange={e => setNameZh(e.target.value)} placeholder={s.nameZhPh} />
        </label>
        <label className="block">
          <span className={INPUT_LABEL}>{s.nameJa}</span>
          <input className={INPUT} value={nameJa} onChange={e => setNameJa(e.target.value)} placeholder={s.nameJaPh} />
        </label>
      </div>
      <p className={`text-xs ${TEXT_SUBTLE}`}>{s.namesHint}</p>

      <label className="block">
        <span className={INPUT_LABEL}>{s.region}</span>
        <input className={INPUT} value={region} onChange={e => setRegion(e.target.value)} placeholder={s.regionPh} />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={INPUT_LABEL}>{s.latitude}</span>
          <input type="number" step="any" className={INPUT} value={latitude}
            onChange={e => setLatitude(e.target.value)} placeholder="25.1263" />
        </label>
        <label className="block">
          <span className={INPUT_LABEL}>{s.longitude}</span>
          <input type="number" step="any" className={INPUT} value={longitude}
            onChange={e => setLongitude(e.target.value)} placeholder="121.8321" />
        </label>
      </div>

      {shown.length > 0 && (
        <div className={`${CARD} space-y-2 p-3`} role="status">
          <p className={`text-sm ${TEXT_HEADING}`}>{s.maybeExists}</p>
          <ul className="space-y-2">
            {shown.map(m => (
              <li key={m.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={`text-sm ${TEXT_BODY}`}>
                    {siteName(m)}
                    {!m.verified && <span className={`ml-2 text-xs ${TEXT_SUBTLE}`}>{s.unverified}</span>}
                  </p>
                  {/* The other names and the region are what let a diver tell
                      "that is the place I mean" from "that is a different reef
                      with a similar name". Without them the suggestion is a
                      bare string and they have no way to judge it. */}
                  <p className={`text-xs ${TEXT_SUBTLE}`}>
                    {[...otherSiteNames(m), m.region].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button type="button" className={BTN_XS_PRIMARY} onClick={() => onPick(m.id)}>
                  {s.useThis}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className={ERROR_NOTE_LIGHT}>{error}</p>}

      {/* Both stretched: BTN_SECONDARY carries no horizontal padding, because
          every caller pairs it with flex-1. Left to size itself, its label
          spills out of its own border. */}
      <div className="flex gap-2">
        <button type="button" className={`flex-1 ${BTN_PRIMARY}`} disabled={submitting} onClick={submit}>
          {submitting ? s.adding : shown.length > 0 ? s.addAnyway : s.addPlace}
        </button>
        <button type="button" className={`flex-1 ${BTN_SECONDARY}`} onClick={onCancel}>{s.cancel}</button>
      </div>
    </div>
  )
}
