// Cloudflare Workers entry. Wraps the static `dist/` bundle (served
// via the ASSETS binding) with the security-headers layer defined in
// src/security-headers.ts. Replaces the previous "[assets]-only" mode
// of wrangler.toml which served the SPA with zero security headers.
//
// See docs/security-audit.md → H5 for the rationale.

import { applySecurityHeaders } from './security-headers'

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.ASSETS.fetch(request)
    return new Response(response.body, {
      status:     response.status,
      statusText: response.statusText,
      headers:    applySecurityHeaders(response.headers),
    })
  },
}
