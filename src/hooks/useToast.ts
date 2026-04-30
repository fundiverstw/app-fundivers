import { createContext, useContext } from 'react'

// Tiny in-house toast system. Save handlers across the app call
// toast.success(...) / toast.error(...) and a single ToastProvider
// (mounted near the root) renders the bubbles in a fixed-position
// stack. Auto-dismissed after a few seconds.

export type ToastVariant = 'success' | 'error' | 'info'

export interface ToastApi {
  success: (message: string) => void
  error:   (message: string) => void
  info:    (message: string) => void
}

// No-op fallback so components can call `useToast()` even outside the
// provider (e.g. in unit tests that don't wrap with ToastProvider) —
// the call is silent rather than throwing.
const NOOP: ToastApi = {
  success: () => { /* no-op */ },
  error:   () => { /* no-op */ },
  info:    () => { /* no-op */ },
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP
}
