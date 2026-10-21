import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { EligibilityEvent } from '../lib/prereq-shortfall'

// Each event's prerequisite columns, keyed by event id. The register forms
// grade on these, the same row the server refuses on; an event is absent
// until its row has loaded.
export function usePrereqEvents(ids: readonly string[]): Record<string, EligibilityEvent> {
  const [byId, setById] = useState<Record<string, EligibilityEvent>>({})
  const key = ids.join(',')
  useEffect(() => {
    const list = key ? key.split(',') : []
    if (list.length === 0) return
    let cancelled = false
    supabase
      .from('events' as never)
      .select('id, prereq_cert_id, req_dives, nitrox_required')
      .in('id', list)
      .then(({ data }) => {
        if (cancelled || !Array.isArray(data)) return
        const rows = data as Array<EligibilityEvent & { id: string }>
        setById(Object.fromEntries(rows.map(r => [r.id, r])))
      })
    return () => { cancelled = true }
  }, [key])
  return byId
}
