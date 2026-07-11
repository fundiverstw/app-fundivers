import { useEffect, useState } from 'react'
import { fetchTerms, type Terms } from './terms'

/** The shop's Terms row, memoised across the session. `terms` is null while
 *  loading, and stays null if the read failed — callers must fail open. */
export function useTerms(): { terms: Terms | null; loading: boolean } {
  const [terms, setTerms] = useState<Terms | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchTerms().then(t => {
      if (cancelled) return
      setTerms(t)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  return { terms, loading }
}
