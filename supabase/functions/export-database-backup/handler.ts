// Pure handler for export-database-backup. The Deno entry (index.ts) builds the
// production deps — service-role client, fflate — and forwards here; the vitest
// suite builds in-memory ones. Deno-import-free for that reason.
//
// What this is: every row of every public table, one CSV per table, zipped, for
// an admin to keep off the shop's Supabase project. A shop that loses its
// account, or gets locked out of it, still holds its bookings and its divers'
// details in a form any spreadsheet opens.
//
// What it is NOT: a restorable SQL dump. There is no schema, no constraint, no
// function and no storage object in here, and auth.users (the credentials) is
// out of reach of the public schema by design. `make backup-prod` is the
// pg_dump for a rollback point; this is the copy a shop owner can actually
// keep on a laptop.

import { Buffer } from "node:buffer"
import { buildTableCsv } from "../_shared/csv.ts"
import { corsHeaders, safeError } from "../_shared/responses.ts"
import { takeActionSlot, rateLimitedBody, type RpcClient } from "../_shared/rate-limit.ts"
import { siteConfig } from "../../../fundive.config.ts"

// PostgREST caps a request at 1000 rows, so every table is read a page at a
// time, ordered by its primary key to keep the page boundaries stable.
const PAGE_SIZE = 1000

// A ceiling on the whole archive. The function builds the ZIP in memory, and an
// edge runtime that runs out of it fails with nothing useful to say; refusing
// past a known-good size at least names the problem. Well above what a dive
// shop accumulates in years of operating.
export const MAX_TOTAL_ROWS = 250_000

interface TableInventoryRow {
  table_name:  string
  columns:     string[]
  key_columns: string[]
}

export interface BackupAdminClient extends RpcClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any
}

export interface AuthedClient {
  auth: {
    getUser(): Promise<{
      data: { user: { id: string; email?: string | null } | null }
      error: { message: string } | null
    }>
  }
}

export interface Deps {
  admin:            BackupAdminClient
  makeAuthedClient: (token: string) => AuthedClient
  /** fflate's zipSync in production; a recording stub in tests. */
  zip:              (files: Record<string, Uint8Array>) => Uint8Array
  now?:             () => Date
}

export async function handleDatabaseBackup(req: Request, deps: Deps): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(req) },
  })
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) })
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)

  const auth = req.headers.get("Authorization") ?? ""
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401)
  const { data: who, error: whoErr } = await deps.makeAuthedClient(auth.slice("Bearer ".length)).auth.getUser()
  const callerId = who?.user?.id ?? null
  if (whoErr || !callerId) return json({ error: "unauthorized" }, 401)

  const admin = deps.admin

  // Admin only, and deliberately not staff: this hands over every diver's
  // personal details, every payment and every waiver in one file.
  const { data: me } = await admin.from("profiles").select("role").eq("id", callerId).single()
  if ((me as { role?: string } | null)?.role !== "admin") return json({ error: "forbidden" }, 403)

  // Building the archive reads the whole database. Bounded so a loop cannot
  // turn the export into a way to hammer the project's egress.
  const slot = await takeActionSlot(admin, callerId, "database_backup")
  if (!slot.allowed) return json(rateLimitedBody("database_backup", slot.retryAfterSeconds), 429)

  const { data: inventoryData, error: invErr } = await admin.rpc("backup_table_inventory")
  if (invErr) return json({ error: safeError(invErr, "could not read the table list") }, 500)
  const inventory = (inventoryData ?? []) as TableInventoryRow[]
  if (inventory.length === 0) return json({ error: "no tables to back up" }, 500)

  const generatedAt = (deps.now?.() ?? new Date()).toISOString()
  const files: Record<string, Uint8Array> = {}
  const encoder = new TextEncoder()
  const counts: Array<{ table: string; rows: number }> = []
  let totalRows = 0

  for (const table of inventory) {
    const rows: Array<Record<string, unknown>> = []
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = admin.from(table.table_name).select("*")
      for (const key of table.key_columns) query = query.order(key, { ascending: true })
      const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1)
      if (error) return json({ error: safeError(error, `could not read ${table.table_name}`) }, 500)
      const page = (data ?? []) as Array<Record<string, unknown>>
      rows.push(...page)
      totalRows += page.length
      if (totalRows > MAX_TOTAL_ROWS) {
        return json({ error: "this database is too large to back up from the browser" }, 413)
      }
      if (page.length < PAGE_SIZE) break

      // A table with no primary key has no stable page order, so a second page
      // could repeat or skip rows. Every table in this schema has one; if that
      // ever stops being true, say so rather than shipping a quietly wrong
      // archive.
      if (table.key_columns.length === 0) {
        return json({ error: `${table.table_name} has no primary key to page by` }, 500)
      }
    }
    counts.push({ table: table.table_name, rows: rows.length })
    files[`${table.table_name}.csv`] = encoder.encode(buildTableCsv(table.columns, rows))
  }

  const rowTotal = counts.reduce((sum, c) => sum + c.rows, 0)
  files["manifest.csv"] = encoder.encode(
    buildTableCsv(["table", "rows"], counts.map(c => ({ table: c.table, rows: c.rows }))),
  )
  files["README.txt"] = encoder.encode(readme(generatedAt, counts.length, rowTotal))

  const zipped = deps.zip(files)
  const shopSlug = siteConfig.identity.shortName.replace(/[^\w.-]+/g, "-").toLowerCase() || "shop"
  return json({
    ok:          true,
    filename:    `${shopSlug}-backup-${generatedAt.slice(0, 10)}.zip`,
    table_count: counts.length,
    row_count:   rowTotal,
    zip_base64:  Buffer.from(zipped).toString("base64"),
  })
}

function readme(generatedAt: string, tableCount: number, rowCount: number): string {
  return [
    `${siteConfig.identity.shopName} — database backup`,
    ``,
    `Taken:  ${generatedAt}`,
    `Holds:  ${tableCount} tables, ${rowCount} rows, one CSV each (see manifest.csv).`,
    ``,
    `This is a copy of the shop's data, readable in any spreadsheet. It is a`,
    `snapshot, not a running system: it carries no database structure, so`,
    `restoring it means importing the CSVs into a database that already has the`,
    `right tables.`,
    ``,
    `Not included: sign-in credentials (they live outside the shop's own tables`,
    `and cannot be exported), and uploaded files — certification cards, signed`,
    `waiver PDFs, dive-site maps — which are stored as files rather than rows.`,
    ``,
    `It does include personal data: names, dates of birth, contact details,`,
    `emergency contacts, payment records and waiver signatures. Keep it`,
    `somewhere you would be willing to keep a filing cabinet of the same.`,
    ``,
  ].join("\n")
}
