import { useState } from 'react'
import { DiveSiteScene } from '../../components/divesites/DiveSiteScene'
import { SiteMapEditor } from '../../components/divesites/SiteMapEditor'
import { LONGDONG_4 } from '../../lib/site-seeds'
import { observedOnly, type DiveSiteMap } from '../../lib/dive-site-map'
import type { SiteContribution } from '../../lib/site-map-draft'
import { PAGE_HEADING, PAGE_BODY, BTN_XS_PRIMARY, BTN_XS_GHOST } from '../../styles/tokens'

// Development-only workbench for the site-map feature, at /dev/site-map.
//
// The site starts empty, as Longdong 4 genuinely is here: nothing is copied
// from anyone's drawing and nothing is generated. Contributions made in the
// editor are held in page state so the loop can be walked end to end — add
// depths, look at the flat map, look at the surface they produce — before any
// of it is persisted.

type View = 'edit' | '3d'

export function DiveSiteMapPreviewPage() {
  const [site, setSite] = useState<DiveSiteMap>(LONGDONG_4)
  const [view, setView] = useState<View>('edit')
  const observed = observedOnly(site)

  function accept(contribution: SiteContribution) {
    setSite(prev => ({
      ...prev,
      soundings: [...prev.soundings, ...contribution.soundings],
      features: [...prev.features, ...contribution.features],
    }))
  }

  const tab = (key: View, label: string) => (
    <button
      key={key}
      onClick={() => setView(key)}
      className={view === key ? BTN_XS_PRIMARY : BTN_XS_GHOST}
    >
      {label}
    </button>
  )

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className={`text-lg font-bold ${PAGE_HEADING}`}>
          {site.name} <span className="font-normal opacity-70">· {site.name_en}</span>
        </h1>
        <p className={`text-sm ${PAGE_BODY}`}>
          Development workbench. The site starts flat and empty — every depth and
          feature on it has to be contributed. {observed.soundings.length} depths and{' '}
          {observed.features.length} features so far, held in this page only.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tab('edit', 'Contribute')}
        {tab('3d', 'Surface')}
      </div>

      {view === 'edit' && (
        <SiteMapEditor
          map={site}
          contributor={{ id: 'dev-diver', name: 'Dev Diver' }}
          onSubmit={accept}
        />
      )}
      {view === '3d' && <DiveSiteScene map={site} height={460} />}
    </div>
  )
}
