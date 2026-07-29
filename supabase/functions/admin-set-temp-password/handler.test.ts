import { describe, it, expect, vi } from "vitest"
import { handleSetTempPassword, generateTempPassword, type Deps } from "./handler.ts"

const CALLER = "admin-1"
const TARGET = "diver-1"

function makeReq(
  body: unknown,
  { method = "POST", auth = "Bearer good", json = true }: { method?: string; auth?: string | null; json?: boolean } = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json", Origin: "http://localhost:5173" }
  if (auth) headers["Authorization"] = auth
  return new Request("https://x/admin-set-temp-password", {
    method,
    headers,
    body: body === undefined ? undefined : json ? JSON.stringify(body) : (body as string),
  })
}

function makeDeps(opts: {
  callerRole?: string | null
  targetExists?: boolean
  updateError?: string | null
  auditError?: { message: string } | null
  getUserOk?: boolean
} = {}) {
  const {
    callerRole = "admin",
    targetExists = true,
    updateError = null,
    auditError = null,
    getUserOk = true,
  } = opts

  const captured = {
    updateCalls: [] as Array<{ id: string; attrs: { password?: string } }>,
    auditInserts: [] as Array<Record<string, unknown>>,
  }

  const anon: Deps["anon"] = {
    auth: {
      getUser: vi.fn(async () =>
        getUserOk
          ? { data: { user: { id: CALLER, email: "a@a" } }, error: null }
          : { data: { user: null }, error: { message: "bad token" } },
      ),
    },
  }

  const admin: Deps["admin"] = {
    auth: {
      admin: {
        updateUserById: vi.fn(async (id: string, attrs: { password?: string }) => {
          captured.updateCalls.push({ id, attrs })
          return updateError
            ? { data: { user: null }, error: { message: updateError } }
            : { data: { user: { id, email: "d@d" } }, error: null }
        }),
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: vi.fn((table: string): any => {
      if (table === "admin_audit_log") {
        return { insert: vi.fn(async (row: Record<string, unknown>) => { captured.auditInserts.push(row); return { error: auditError } }) }
      }
      // profiles: .select(cols).eq('id', val).maybeSingle()
      return {
        select: () => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: async () => {
              if (val === CALLER) return { data: callerRole ? { role: callerRole } : null, error: null }
              if (val === TARGET) return { data: targetExists ? { id: TARGET } : null, error: null }
              return { data: null, error: null }
            },
          }),
        }),
      }
    }),
  }

  return { deps: { admin, anon, generatePassword: () => "ABCD-EFGH-JKLM" } as Deps, captured }
}

describe("handleSetTempPassword", () => {
  it("issues a temp password and returns the plaintext once", async () => {
    const { deps, captured } = makeDeps()
    const res = await handleSetTempPassword(makeReq({ user_id: TARGET }), deps)
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; password: string }
    expect(body).toEqual({ ok: true, password: "ABCD-EFGH-JKLM" })
    // Set on the TARGET, not the caller.
    expect(captured.updateCalls).toEqual([{ id: TARGET, attrs: { password: "ABCD-EFGH-JKLM" } }])
  })

  it("writes an audit row WITHOUT the plaintext password", async () => {
    const { deps, captured } = makeDeps()
    await handleSetTempPassword(makeReq({ user_id: TARGET }), deps)
    expect(captured.auditInserts).toHaveLength(1)
    const row = captured.auditInserts[0]!
    expect(row).toMatchObject({ actor_id: CALLER, action: "update", target_table: "auth.users", target_id: TARGET })
    // The secret must never be persisted.
    expect(JSON.stringify(row)).not.toContain("ABCD-EFGH-JKLM")
  })

  it("rejects a non-admin caller with 403 and never touches auth", async () => {
    const { deps, captured } = makeDeps({ callerRole: "diver" })
    const res = await handleSetTempPassword(makeReq({ user_id: TARGET }), deps)
    expect(res.status).toBe(403)
    expect(captured.updateCalls).toHaveLength(0)
  })

  it("401s a missing bearer token", async () => {
    const { deps } = makeDeps()
    const res = await handleSetTempPassword(makeReq({ user_id: TARGET }, { auth: null }), deps)
    expect(res.status).toBe(401)
  })

  it("401s an invalid bearer token", async () => {
    const { deps, captured } = makeDeps({ getUserOk: false })
    const res = await handleSetTempPassword(makeReq({ user_id: TARGET }), deps)
    expect(res.status).toBe(401)
    expect(captured.updateCalls).toHaveLength(0)
  })

  it("404s when the target profile does not exist", async () => {
    const { deps, captured } = makeDeps({ targetExists: false })
    const res = await handleSetTempPassword(makeReq({ user_id: TARGET }), deps)
    expect(res.status).toBe(404)
    expect(captured.updateCalls).toHaveLength(0)
  })

  it("400s a missing user_id", async () => {
    const { deps } = makeDeps()
    const res = await handleSetTempPassword(makeReq({}), deps)
    expect(res.status).toBe(400)
  })

  it("405s a non-POST method", async () => {
    const { deps } = makeDeps()
    const res = await handleSetTempPassword(makeReq(undefined, { method: "GET" }), deps)
    expect(res.status).toBe(405)
  })

  it("400s when the auth update fails", async () => {
    const { deps } = makeDeps({ updateError: "boom" })
    const res = await handleSetTempPassword(makeReq({ user_id: TARGET }), deps)
    expect(res.status).toBe(400)
  })

  it("still succeeds when the audit insert fails (password is already set)", async () => {
    const { deps, captured } = makeDeps({ auditError: { message: "audit down" } })
    const res = await handleSetTempPassword(makeReq({ user_id: TARGET }), deps)
    expect(res.status).toBe(200)
    expect(captured.updateCalls).toHaveLength(1)
  })
})

describe("generateTempPassword", () => {
  it("is XXXX-XXXX-XXXX from an unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateTempPassword()
      expect(pw).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
      // The alphabet deliberately drops the visually ambiguous 0/1/I/O.
      expect(pw).not.toMatch(/[01IO]/)
    }
  })
})
