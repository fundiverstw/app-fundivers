import type { ReactElement } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

export function renderWithRouter(
  ui: ReactElement,
  { route = '/', ...options }: { route?: string } & RenderOptions = {}
) {
  return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>, options)
}

/**
 * Pages use a Field-style layout where labels are siblings of inputs without
 * for/id associations, so `getByLabelText` doesn't work. Look up form controls
 * by their `name` attribute (set by react-hook-form `register`).
 */
export function byName<T extends HTMLElement = HTMLInputElement>(name: string): T {
  const el = document.querySelector(`[name="${name}"]`)
  if (!el) throw new Error(`no form control with name=${name}`)
  return el as T
}

/**
 * Returns a chainable stub that mimics the subset of supabase-js's PostgrestBuilder
 * used throughout this app. Any chained method returns the same builder; awaiting
 * it (or calling `.then(...)` / `.single()`) resolves to `{ data, error }`.
 */
type QueryResult<T> = { data?: T; error?: unknown }
export function mockQueryBuilder<T = unknown>(result: QueryResult<T> = { data: null, error: null }) {
  const resolved = { data: result.data ?? null, error: result.error ?? null }
  const builder: Record<string, unknown> = {}
  const chainable = ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'not', 'or', 'order', 'limit', 'filter', 'match']
  const mutating = ['insert', 'update', 'upsert', 'delete']
  for (const m of [...chainable, ...mutating]) {
    builder[m] = () => builder
  }
  builder.single = () => Promise.resolve(resolved)
  builder.maybeSingle = () => Promise.resolve(resolved)
  builder.then = (onFulfilled?: (r: typeof resolved) => unknown) =>
    Promise.resolve(resolved).then(onFulfilled)
  return builder
}
