/**
 * Dive-site maps: what the seabed at a place looks like, built out of readings
 * divers file one at a time.
 *
 * The renderer, the editor and the model behind them existed for months behind
 * a development-only route, where a diver could place depths, look at the
 * surface they made, and lose all of it on reload. Nothing was ever written
 * down. This is the same two views against real storage.
 *
 * A place is picked from the catalog rather than named here — the same catalog
 * the almanac files conditions against — so a map and an observation are about
 * the same Bat Cave, and a site nobody has mapped yet opens as an empty canvas
 * rather than as an error.
 *
 * Staff-facing for now, behind AdminRoute and admin-only RLS (20260827600000).
 * The editor puts whoever opens it one tap from writing a depth onto a map
 * everyone else reads, so until the shop has seen what that produces, the
 * people doing it are the people who can also undo it. Nothing here assumes
 * that: opening it to divers is a policy swap and a route guard.
 */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { t } from '../i18n'
import { DiveSiteScene } from '../components/divesites/DiveSiteScene'
import { SiteMapEditor } from '../components/divesites/SiteMapEditor'
import { fetchSiteMap, submitSiteMapContribution } from '../lib/site-map-store'
import { fetchDiveSites, siteName } from '../lib/dive-sites'
import { observedOnly, type DiveSiteMap } from '../lib/dive-site-map'
import type { SiteContribution } from '../lib/site-map-draft'
import { personName } from '../lib/names'
import { errorMessage } from '../lib/errors'
import type { DiveSite } from '../types/database'
import {
  CARD, INPUT, INPUT_LABEL, TEXT_HEADING, TEXT_BODY, TEXT_SUBTLE,
} from '../styles/tokens'

const PILL = 'px-3 py-1.5 rounded-lg text-sm font-semibold'

type View = 'edit' | 'surface'

export function SiteMapPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const sm = t.siteMaps

  const [sites, setSites] = useState<DiveSite[]>([])
  const [siteId, setSiteId] = useState('')
  const [map, setMap] = useState<DiveSiteMap | null>(null)
  const [view, setView] = useState<View>('edit')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchDiveSites()
      .then(rows => {
        if (cancelled) return
        const usable = rows.filter(s => s.active)
        setSites(usable)
        setSiteId(prev => prev || usable[0]?.id || '')
      })
      .catch(err => { if (!cancelled) setError(errorMessage(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const site = sites.find(s => s.id === siteId) ?? null

  const load = useCallback(async (target: DiveSite) => {
    setMap(await fetchSiteMap(target))
  }, [])

  useEffect(() => {
    if (!site) return
    let cancelled = false
    // Awaited inside, so nothing sets state on the render that scheduled this.
    const run = async () => {
      try {
        const next = await fetchSiteMap(site)
        if (!cancelled) setMap(next)
      } catch (err) {
        if (!cancelled) setError(errorMessage(err))
      }
    }
    void run()
    return () => { cancelled = true }
  }, [site])

  async function accept(contribution: SiteContribution) {
    if (!site) return
    try {
      await submitSiteMapContribution({ siteId: site.id, contribution })
      // Re-read rather than merge locally: the lattice reconciles a reading
      // against one somebody else already filed on the same square metre, and
      // only the database knows what survived that.
      await load(site)
      toast.success(sm.filed)
    } catch (err) {
      toast.error(sm.filingFailed(errorMessage(err)))
    }
  }

  const observed = map ? observedOnly(map) : null

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className={`text-xl font-bold ${TEXT_HEADING}`}>{sm.title}</h1>
        <p className={`text-sm ${TEXT_BODY}`}>{sm.blurb}</p>
      </div>

      {error && <p className={`${CARD} p-4 text-sm ${TEXT_SUBTLE}`}>{error}</p>}

      <label className="block">
        <span className={INPUT_LABEL}>{sm.place}</span>
        <select className={INPUT} value={siteId} onChange={e => setSiteId(e.target.value)}>
          {sites.map(s => (
            <option key={s.id} value={s.id}>
              {s.region ? `${siteName(s)} — ${s.region}` : siteName(s)}
            </option>
          ))}
        </select>
      </label>

      {!loading && sites.length === 0 && (
        <p className={`${CARD} p-4 text-center text-sm ${TEXT_SUBTLE}`}>{sm.noPlaces}</p>
      )}

      {map && observed && (
        <>
          {/* Stated before either view, because an empty site is the ordinary
              state of a place nobody has measured and a canvas with nothing on
              it otherwise reads as something failing to load. */}
          <p className={`text-xs ${TEXT_SUBTLE}`}>
            {sm.coverage(observed.soundings.length, observed.features.length)}
          </p>

          <div className="flex gap-2" role="tablist" aria-label={sm.viewsAria}>
            <button
              type="button" role="tab" aria-selected={view === 'edit'}
              onClick={() => setView('edit')}
              className={`${PILL} ${view === 'edit' ? 'bg-brand-600 text-white' : 'bg-white/70 text-brand-900 hover:bg-white/90'}`}
            >
              {sm.tabContribute}
            </button>
            <button
              type="button" role="tab" aria-selected={view === 'surface'}
              onClick={() => setView('surface')}
              className={`${PILL} ${view === 'surface' ? 'bg-brand-600 text-white' : 'bg-white/70 text-brand-900 hover:bg-white/90'}`}
            >
              {sm.tabSurface}
            </button>
          </div>

          {view === 'edit' ? (
            <SiteMapEditor
              map={map}
              contributor={profile
                ? { id: profile.id, name: personName(profile.name, profile.nickname) }
                : undefined}
              onSubmit={accept}
            />
          ) : (
            <DiveSiteScene map={map} height={460} />
          )}
        </>
      )}
    </div>
  )
}
