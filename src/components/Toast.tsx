import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type ToastApi, type ToastVariant } from '../hooks/useToast'

// Auto-dismiss after this many milliseconds. Long enough to read a
// short success message, short enough not to linger.
const DEFAULT_TTL_MS = 3000

interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextIdRef = useRef(1)

  const push = useCallback((message: string, variant: ToastVariant) => {
    const id = nextIdRef.current++
    setItems(prev => [...prev, { id, message, variant }])
    setTimeout(() => {
      setItems(prev => prev.filter(t => t.id !== id))
    }, DEFAULT_TTL_MS)
  }, [])

  // useMemo so the API object identity is stable across renders — keeps
  // consumer effects that depend on it from re-firing every render.
  const api = useMemo<ToastApi>(() => ({
    success: m => push(m, 'success'),
    error:   m => push(m, 'error'),
    info:    m => push(m, 'info'),
  }), [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-xs pointer-events-none"
      >
        {items.map(t => (
          <div
            key={t.id}
            className={
              'pointer-events-auto px-4 py-2 rounded-lg shadow-lg text-sm font-medium border ' +
              (t.variant === 'success' ? 'bg-green-50 border-green-500 text-green-900' :
               t.variant === 'error'   ? 'bg-red-50 border-accent text-red-900' :
                                          'bg-surface-50 border-surface-500 text-brand-900')
            }
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
