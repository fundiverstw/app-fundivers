import { describe, it, expect, vi } from "vitest"
import { handleDatabaseBackup, MAX_TOTAL_ROWS, type Deps } from "./handler.ts"

const ADMIN = "admin-1"

function makeReq({ method = "POST", auth = "Bearer good" }: { method?: string; auth?: string | null } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json", Origin: "http://localhost:5173" }
  if (auth) headers["Authorization"] = auth
  // GET/HEAD may not carry a body, and this endpoint takes no input anyway.
  return new Request("https://x/export-database-backup", {
    method, headers, body: method === "POST" ? "{}" : undefined,
  })
}

interface TableFixture {
  columns: string[]
  key_columns?: string[]
  rows: Array<Record<string, unknown>>
}

function makeDeps(opts: {
  callerRole?: string | null
  tables?: Record<string, TableFixture>
  inventoryError?: { message: string; code?: string } | null
  readError?: { message: string; code?: string } | null
  slotSeconds?: number
  getUserOk?: boolean
} = {}) {
  const {
    callerRole = "admin",
    tables = {
      bookings: { columns: ["id", "status"], rows: [{ id: "b1", status: "pending" }] },
      profiles: { columns: ["id", "name"], rows: [{ id: ADMIN, name: 'Ada, "the admin"' }] },
      audit:    { columns: ["id", "note"], rows: [] },
    },
    inventoryError = null,
    readError = null,
    slotSeconds = 0,
    getUserOk = true,
  } = opts

  // Every file handed to zipSync, decoded — the archive's contents without
  // needing to unzip anything.
  const zipped: Record<string, string> = {}
  const rangesAsked: Array<{ table: string; from: number; to: number }> = []
  const ordersAsked: Array<{ table: string; column: string }> = []

  const admin: Deps["admin"] = {
    rpc: vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "take_action_slot") {
        expect(args?.p_action).toBe("database_backup")
        return { data: slotSeconds, error: null }
      }
      if (fn === "backup_table_inventory") {
        if (inventoryError) return { data: null, error: inventoryError }
        return {
          data: Object.entries(tables).map(([table_name, t]) => ({
            table_name, columns: t.columns, key_columns: t.key_columns ?? ["id"],
          })),
          error: null,
        }
      }
      return { data: null, error: null }
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: vi.fn((table: string): any => {
      if (table === "profiles" && callerRole !== undefined) {
        // The role check runs before any table read; the data read of the same
        // table goes through select('*') below.
        const builder = {
          select: (cols: string) => cols === "role"
            ? { eq: () => ({ single: async () => ({ data: callerRole ? { role: callerRole } : null, error: null }) }) }
            : dataBuilder(table),
        }
        return builder
      }
      return { select: () => dataBuilder(table) }
    }),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function dataBuilder(table: string): any {
    const builder = {
      order: (column: string) => { ordersAsked.push({ table, column }); return builder },
      range: async (from: number, to: number) => {
        rangesAsked.push({ table, from, to })
        if (readError) return { data: null, error: readError }
        return { data: (tables[table]?.rows ?? []).slice(from, to + 1), error: null }
      },
    }
    return builder
  }

  const deps: Deps = {
    admin,
    makeAuthedClient: () => ({
      auth: {
        getUser: async () => getUserOk
          ? { data: { user: { id: ADMIN, email: "a@a" } }, error: null }
          : { data: { user: null }, error: { message: "bad token" } },
      },
    }),
    zip: (files) => {
      const decoder = new TextDecoder()
      for (const [name, bytes] of Object.entries(files)) zipped[name] = decoder.decode(bytes)
      return new Uint8Array([1, 2, 3])
    },
    now: () => new Date("2026-09-05T08:30:00.000Z"),
  }

  return { deps, zipped, rangesAsked, ordersAsked }
}

describe("export-database-backup handler", () => {
  it("writes one CSV per table, plus a manifest and a README", async () => {
    const { deps, zipped } = makeDeps()
    const res = await handleDatabaseBackup(makeReq(), deps)
    expect(res.status).toBe(200)

    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.table_count).toBe(3)
    expect(body.row_count).toBe(2)
    expect(body.zip_base64).toBe("AQID")
    // Dated so two backups of the same shop don't overwrite each other.
    expect(body.filename).toMatch(/-backup-2026-09-05\.zip$/)

    expect(Object.keys(zipped).sort())
      .toEqual(["README.txt", "audit.csv", "bookings.csv", "manifest.csv", "profiles.csv"])
    expect(zipped["bookings.csv"]).toBe("id,status\r\nb1,pending\r\n")
    // A cell carrying a comma and quotes survives the round trip.
    expect(zipped["profiles.csv"]).toBe(`id,name\r\n${ADMIN},"Ada, ""the admin"""\r\n`)
    expect(zipped["manifest.csv"]).toBe("table,rows\r\nbookings,1\r\nprofiles,1\r\naudit,0\r\n")
  })

  it("keeps an empty table as a header-only CSV rather than dropping it", async () => {
    const { deps, zipped } = makeDeps()
    await handleDatabaseBackup(makeReq(), deps)
    // "this table is empty" and "this table is missing" must not look alike.
    expect(zipped["audit.csv"]).toBe("id,note\r\n")
  })

  it("says what the archive holds and what it leaves behind", async () => {
    const { deps, zipped } = makeDeps()
    await handleDatabaseBackup(makeReq(), deps)
    expect(zipped["README.txt"]).toMatch(/3 tables, 2 rows/)
    expect(zipped["README.txt"]).toMatch(/Not included: sign-in credentials/)
    expect(zipped["README.txt"]).toMatch(/personal data/)
  })

  it("pages a table larger than one request, ordered by its primary key", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: `r${String(i).padStart(4, "0")}`, n: i }))
    const { deps, zipped, rangesAsked, ordersAsked } = makeDeps({
      tables: { big: { columns: ["id", "n"], rows } },
    })
    const res = await handleDatabaseBackup(makeReq(), deps)
    expect(res.status).toBe(200)

    expect(rangesAsked).toEqual([
      { table: "big", from: 0, to: 999 },
      { table: "big", from: 1000, to: 1999 },
    ])
    // Without an ORDER BY the two pages could overlap or skip.
    expect(ordersAsked).toContainEqual({ table: "big", column: "id" })
    expect(zipped["big.csv"].trimEnd().split("\r\n")).toHaveLength(1501)
  })

  it("refuses a database too large to build in memory instead of truncating it", async () => {
    const rows = Array.from({ length: MAX_TOTAL_ROWS + PAGE_OVERSHOOT }, (_, i) => ({ id: i, n: i }))
    const { deps } = makeDeps({ tables: { huge: { columns: ["id", "n"], rows } } })
    const res = await handleDatabaseBackup(makeReq(), deps)
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/too large/i) })
  })

  it("turns away everyone but an admin", async () => {
    for (const role of ["staff", "diver", null]) {
      const { deps, zipped } = makeDeps({ callerRole: role })
      const res = await handleDatabaseBackup(makeReq(), deps)
      expect(res.status).toBe(403)
      expect(Object.keys(zipped)).toHaveLength(0)
    }
  })

  it("turns away a request with no usable token", async () => {
    const { deps } = makeDeps()
    expect((await handleDatabaseBackup(makeReq({ auth: null }), deps)).status).toBe(401)

    const bad = makeDeps({ getUserOk: false })
    expect((await handleDatabaseBackup(makeReq(), bad.deps)).status).toBe(401)
  })

  it("refuses anything but POST", async () => {
    const { deps } = makeDeps()
    expect((await handleDatabaseBackup(makeReq({ method: "GET" }), deps)).status).toBe(405)
    expect((await handleDatabaseBackup(makeReq({ method: "OPTIONS" }), deps)).status).toBe(200)
  })

  it("stops at the rate limit", async () => {
    const { deps, zipped } = makeDeps({ slotSeconds: 3600 })
    const res = await handleDatabaseBackup(makeReq(), deps)
    expect(res.status).toBe(429)
    expect(Object.keys(zipped)).toHaveLength(0)
  })

  it("reports a read failure rather than shipping a partial archive", async () => {
    const inventory = makeDeps({ inventoryError: { message: "boom", code: "42501" } })
    expect((await handleDatabaseBackup(makeReq(), inventory.deps)).status).toBe(500)
    expect(Object.keys(inventory.zipped)).toHaveLength(0)

    const read = makeDeps({ readError: { message: "boom", code: "42501" } })
    expect((await handleDatabaseBackup(makeReq(), read.deps)).status).toBe(500)
    expect(Object.keys(read.zipped)).toHaveLength(0)
  })
})

// One row past the ceiling, once the last page has been read.
const PAGE_OVERSHOOT = 1
