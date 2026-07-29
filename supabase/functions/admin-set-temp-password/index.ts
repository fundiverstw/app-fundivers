// admin-set-temp-password — Deno entry. All logic lives in handler.ts so
// vitest can unit-test it from Node with mocked deps. This file only builds
// the production supabase-js clients and forwards the Request.

import { createClient } from "jsr:@supabase/supabase-js@2.103.2"
import { handleSetTempPassword, type Deps } from "./handler.ts"

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!

  const deps: Deps = {
    admin: createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }),
    anon:  createClient(SUPABASE_URL, ANON_KEY,    { auth: { persistSession: false } }),
  }

  return handleSetTempPassword(req, deps)
})
