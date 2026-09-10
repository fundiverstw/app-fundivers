import { useEffect, useMemo, useState } from 'react'
import { useShopProfile } from '../../hooks/useShopProfile'
import {
  fetchCertEquivalences, fetchStandardsOrganizations, standardsOrgOf,
  type CertEquivalenceRow,
} from '../../lib/shop-profile'
import { t } from '../../i18n'

const ce = t.admin.certEquivalence

// Manage → Shop Profile → Certification equivalence.
//
// The chart the app itself reads through. `cert_levels.padi_equivalent_id`
// makes PADI the hub every agency's rungs hang off, so two rungs are equivalent
// when they share one — which is what lets the same data be drawn in any
// agency's words without re-mapping. The shop's chosen agency is the default
// column, because that is the vocabulary its staff think in.

const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

export function AdminCertEquivalencePage() {
  const { profile } = useShopProfile()
  const shopOrg = standardsOrgOf(profile)

  // The shop's agency unless the admin has picked another to look at, rather
  // than state seeded from it — which would go stale the moment the profile
  // loads.
  const [lookingAt, setLookingAt] = useState<string | null>(null)
  const viewAs = lookingAt ?? shopOrg

  const [orgs, setOrgs] = useState<string[]>([])
  // Carries the agency it was fetched for, so "loading" is a fact about the
  // data rather than a second flag to keep in step with it.
  const [loaded, setLoaded] = useState<{ org: string; rows: CertEquivalenceRow[] } | null>(null)
  const loading = loaded?.org !== viewAs

  useEffect(() => {
    let cancelled = false
    fetchStandardsOrganizations().then(list => { if (!cancelled) setOrgs(list) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchCertEquivalences(viewAs).then(list => {
      if (!cancelled) setLoaded({ org: viewAs, rows: list })
    })
    return () => { cancelled = true }
  }, [viewAs])

  // One block per agency, in the order the query returned them.
  const byOrg = useMemo(() => {
    const groups = new Map<string, CertEquivalenceRow[]>()
    for (const row of loaded?.rows ?? []) {
      const list = groups.get(row.organization) ?? []
      list.push(row)
      groups.set(row.organization, list)
    }
    return [...groups.entries()]
  }, [loaded])

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">{ce.title}</h1>
      <p className="text-sm text-white/80">{ce.intro}</p>

      <div className="max-w-xs">
        <label className="block text-xs font-semibold text-white mb-1" htmlFor="view-as">{ce.viewAs}</label>
        <select id="view-as" className={FIELD} value={viewAs} onChange={e => setLookingAt(e.target.value)}>
          {orgs.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-white/70">{ce.loading}</p>
      ) : byOrg.length === 0 ? (
        <p className="text-sm text-white/70">{ce.empty}</p>
      ) : (
        <>
          <p className="text-xs text-white/70">{ce.noEquivalentHint}</p>
          {byOrg.map(([org, levels]) => (
            <section key={org} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-2">
              <h2 className="text-lg font-bold text-brand-900">{org}</h2>
              {/* table-fixed + colgroup: an auto layout ignores a td's
                  max-width, and a long agency name would push the table wider
                  than the phone it is being read on. */}
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col className="w-14" />
                    <col />
                    <col />
                  </colgroup>
                  <thead>
                    <tr className="text-left text-xs text-brand-900/70">
                      <th className="py-1 font-semibold">{ce.colRank}</th>
                      <th className="py-1 font-semibold">{ce.colName}</th>
                      <th className="py-1 font-semibold">{ce.colEquivalent}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {levels.map(row => (
                      <tr key={row.code} className="border-t border-surface-200 align-top">
                        <td className="py-1.5 text-brand-900/70">{row.rank}</td>
                        <td className="py-1.5 text-brand-900 break-words">{row.name}</td>
                        <td className="py-1.5 break-words">
                          {row.equivalent_name
                            ? <span className="text-brand-900">{row.equivalent_name}</span>
                            : <span className="text-brand-900/70 italic">{ce.noEquivalent}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
