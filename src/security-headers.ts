// Audit H5 — Content-Security-Policy + sibling response headers added
// to every SPA response by the Cloudflare Worker wrapper in
// src/worker.ts. Pulled out into its own module so the policy can be
// unit-tested without standing up a Worker runtime.
//
// Directives kept tight on purpose:
//   * frame-ancestors 'none'      — clickjacking defence on the admin panel
//   * script-src 'self' …         — only same-origin + Turnstile widget
//   * connect-src 'self' …        — same-origin, Supabase, Turnstile,
//                                    Open-Meteo (admin weather BI fetch)
//   * object-src 'none'           — no flash / java / pdf-embed surface
//   * base-uri 'self'             — pin <base> against rewrite attacks
//
// Wildcards on *.supabase.co are deliberate: the SPA only ever talks
// to one project today, but rotating the project ref shouldn't be a
// CSP change. The blast radius of "any Supabase project" is small
// because the anon key is what scopes access, not the URL.
//
// 'unsafe-inline' on style-src is required because Tailwind components
// generate inline style attributes in some compiled paths. Removing it
// is a separate fight that needs a nonce/hash pass.

const CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src':     ["'self'"],
  'script-src':      ["'self'", 'https://challenges.cloudflare.com'],
  'style-src':       ["'self'", "'unsafe-inline'"],
  'img-src':         ["'self'", 'data:', 'blob:', 'https://*.supabase.co'],
  'font-src':        ["'self'"],
  'connect-src':     ["'self'", 'https://*.supabase.co', 'https://challenges.cloudflare.com', 'https://*.open-meteo.com'],
  'frame-src':       ['https://challenges.cloudflare.com'],
  'worker-src':      ["'self'"],
  'manifest-src':    ["'self'"],
  'frame-ancestors': ["'none'"],
  'base-uri':        ["'self'"],
  'form-action':     ["'self'"],
  'object-src':      ["'none'"],
}

export const CSP_HEADER = Object.entries(CSP_DIRECTIVES)
  .map(([k, v]) => `${k} ${v.join(' ')}`)
  .join('; ')

export const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Content-Security-Policy', CSP_HEADER],
  ['X-Content-Type-Options',  'nosniff'],
  ['X-Frame-Options',         'DENY'],
  ['Referrer-Policy',         'strict-origin-when-cross-origin'],
  ['Permissions-Policy',      'camera=(), geolocation=(), microphone=()'],
]

export function applySecurityHeaders(headers: Headers): Headers {
  const out = new Headers(headers)
  for (const [k, v] of SECURITY_HEADERS) {
    out.set(k, v)
  }
  return out
}
