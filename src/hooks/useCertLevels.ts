import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CertLevel } from '../types/database'

// Every agency's ladder from public.cert_levels (RLS public-read, so a guest on
// the register form can load it too). Fetched once per mount; the table barely
// changes, and a picker that shows yesterday's list is harmless.
export function useCertLevels(): CertLevel[] {
  const [levels, setLevels] = useState<CertLevel[]>([])
  useEffect(() => {
    let cancelled = false
    supabase
      .from('cert_levels')
      .select('*')
      .order('rank')
      .then(({ data }) => {
        if (cancelled) return
        // Tests mock supabase.from with one shared builder that can resolve to
        // shapes other than an array; narrow before anyone calls .map().
        setLevels(Array.isArray(data) ? (data as CertLevel[]) : [])
      })
    return () => { cancelled = true }
  }, [])
  return levels
}
