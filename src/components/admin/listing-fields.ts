// Non-component shared bits for the curated-listing admin editors (Packages,
// Scheduled Trips) — kept out of listing-ui.tsx so that file only exports
// components (react-refresh). Pairs with components/admin/listing-ui.tsx.

/** The standard admin form field styling used across the listing editors. */
export const FIELD =
  'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

/** Customer-facing label for a catalog row (add-on / room), falling back to the
 *  admin title. */
export const catalogLabel = (r: { display_title: string | null; admin_title: string | null }) =>
  r.display_title || r.admin_title || '(untitled)'
