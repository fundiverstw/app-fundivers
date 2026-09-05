// export-database-backup — admin-only. Every public table as a CSV, zipped, for
// an admin to keep a copy of the shop's data outside Supabase.
//
// Body: {} (none)
// Returns: 200 { ok: true, filename, table_count, row_count, zip_base64 }
//          401 / 403 on auth / non-admin, 429 when rate-limited,
//          413 when the database is too large to build in memory.
//
// The logic lives in handler.ts so vitest can exercise it from Node; this file
// is only the Deno wiring.

import { createClient } from "jsr:@supabase/supabase-js@2.103.2"
import { zipSync } from "npm:fflate@0.8.3"
import { handleDatabaseBackup, type Deps } from "./handler.ts"

Deno.serve((req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!

  const deps: Deps = {
    admin: createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }),
    makeAuthedClient: (token) => createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth:   { persistSession: false },
    }),
    zip: (files) => zipSync(files),
  }

  return handleDatabaseBackup(req, deps)
})
