// send-group-summary — emails ONE consolidated PDF for a group of bookings
// submitted together (a parent paying for the family, or one diver across
// several events). The client creates each booking via create-registration
// with suppress_email=true, then calls this once with the shared group_id.
//
// Deno-import-free for the same reason as create-registration's handler:
// vitest unit-tests it from Node with in-memory deps (see handler.test.ts).

import { Buffer } from "node:buffer"
import { corsHeaders, safeError } from "../_shared/responses.ts"
import { siteConfig } from "../../../fundive.config.ts"
import type { GroupRegistrationPdfPayload, GroupDiverColumn } from "../_shared/pdf.ts"
import { t } from "../_shared/i18n.ts"

export interface GroupSummaryBody {
  group_id: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from(table: string): any }

export interface SupabaseAuthedClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string; email: string | null } | null }; error: { message: string } | null }>
  }
}

export interface Transporter {
  sendMail(msg: {
    from?: { name: string; address: string }
    to: string
    subject: string
    text?: string
    attachments?: Array<{ filename: string; content: Uint8Array; contentType: string }>
  }): Promise<unknown>
}

export interface Env {
  companyEmail:    string
  mailFromName:    string
  mailFromAddress: string
}

export interface Deps {
  admin:            AnyClient
  makeAuthedClient: (token: string) => SupabaseAuthedClient
  transporter:      Transporter | null
  buildGroupPdfBase64: (payload: GroupRegistrationPdfPayload) => Promise<string>
  env:              Env
}

interface BookingRow {
  id: string
  user_id: string
  status: string
  details: Record<string, unknown>
  event_id: string | null
  group_id: string | null
  payer_id: string | null
  created_at: string
}

function gearLabel(details: Record<string, unknown>): string {
  const gear = details.gear as { rent?: boolean; included?: boolean; assistance_note?: string } | undefined
  if (gear?.included) return t.pdf.gearIncluded
  if (gear?.assistance_note) return t.pdf.gearNeedsHelpShort
  if (gear?.rent) return t.pdf.alaCarte
  return t.pdf.gearOwn
}

export async function handleGroupSummary(req: Request, deps: Deps): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(req) },
  })
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) })
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)

  let body: GroupSummaryBody
  try { body = await req.json() as GroupSummaryBody } catch { return json({ error: "invalid json" }, 400) }
  if (!body.group_id) return json({ error: "group_id required" }, 400)

  // Caller must present a Bearer token — only an authed member of the group
  // (or its payer) may pull the group's summary.
  const auth = req.headers.get("authorization") ?? ""
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401)
  const token = auth.slice("Bearer ".length)
  const { data: who, error: whoErr } = await deps.makeAuthedClient(token).auth.getUser()
  const callerId = who?.user?.id ?? null
  const callerEmail = who?.user?.email ?? null
  if (whoErr || !callerId) return json({ error: "unauthorized" }, 401)

  const admin = deps.admin
  const { data: bookingsData, error: bErr } = await admin
    .from("bookings")
    .select("id, user_id, status, details, event_id, group_id, payer_id, created_at")
    .eq("group_id", body.group_id)
    .order("created_at", { ascending: true })
  if (bErr) return json(safeError(bErr, "could not load group"), 500)
  const bookings = (bookingsData ?? []) as BookingRow[]
  if (bookings.length === 0) return json({ error: "group not found" }, 404)

  // Authorize: the caller has to be one of the booked divers or the payer.
  const isMember = bookings.some(b => b.user_id === callerId || b.payer_id === callerId)
  if (!isMember) return json({ error: "forbidden" }, 403)

  // Resolve each booking into a diver column. Small groups, so per-booking
  // lookups are fine.
  const divers: GroupDiverColumn[] = []
  let groupTotal = 0
  let groupDeposit = 0
  let allHaveDeposit = true

  for (const b of bookings) {
    const { data: profile } = await admin
      .from("profiles")
      .select("name, nickname, date_of_birth, nationality, cert_level, cert_agency, nitrox_certified")
      .eq("id", b.user_id)
      .maybeSingle()

    const eventId = b.event_id as string
    const { data: event } = await admin
      .from("events")
      .select("kind, display_title, admin_title, calendar_title, start_date, end_date, course_days")
      .eq("id", eventId)
      .maybeSingle()
    const isDive = event?.kind === "dive"

    const eventTitle =
      (event?.display_title as string | null) ||
      (event?.admin_title as string | null) ||
      (event?.calendar_title as string | null) ||
      (isDive ? "Dive" : "Course")
    const courseDays = [...((event?.course_days ?? []) as string[])].filter(Boolean).sort()
    const startDate = (isDive ? (event?.start_date ?? null) : (courseDays[0] ?? null)) as string | null
    const endDate = (isDive ? (event?.end_date ?? null) : (courseDays[courseDays.length - 1] ?? null)) as string | null
    const dateStr = startDate
      ? (startDate + (endDate && endDate !== startDate ? " to " + endDate : ""))
      : null

    const details = b.details ?? {}
    const roomDetail = details.room as { option_id?: string } | undefined
    let room: string | null = null
    if (roomDetail?.option_id) {
      const { data: r } = await admin
        .from("rooms").select("admin_title, display_title").eq("id", roomDetail.option_id).maybeSingle()
      if (r) room = (r.display_title ?? r.admin_title ?? "Room") as string
    }

    const addOnIds = Array.isArray(details.add_ons) ? details.add_ons as string[] : []
    let addons: string[] = []
    if (addOnIds.length) {
      const { data: as } = await admin
        .from("addons").select("id, admin_title, display_title").in("id", addOnIds)
      addons = (as ?? [])
        .map((a: { admin_title?: string | null; display_title?: string | null }) =>
          (a.display_title ?? a.admin_title ?? "") as string)
        .filter((s: string) => s.length > 0)
    }

    const total = (details.total as number | null) ?? null
    const deposit = (details.deposit as number | null) ?? null
    if (total != null) groupTotal += total
    if (deposit != null) groupDeposit += deposit; else allHaveDeposit = false

    divers.push({
      name:        (profile?.name as string | null) ?? "",
      nickname:    (profile?.nickname as string | null) ?? null,
      eventTitle,
      dateStr,
      dob:         (profile?.date_of_birth as string | null) ?? null,
      nationality: (profile?.nationality as string | null) ?? null,
      certLevel:   (profile?.cert_level as string | null) ?? null,
      certOrg:     (profile?.cert_agency as string | null) ?? null,
      nitrox:      !!profile?.nitrox_certified,
      gearLabel:   gearLabel(details),
      ride:        details.transportation ? "Riding with the shop" : "Driving themselves",
      room,
      addons,
      status:      b.status,
      deposit,
      total,
    })
  }

  // The lead settles once, so the group shares one payment method — take it
  // from the first booking (the client sends the same method on every call).
  const firstDetails = bookings[0].details ?? {}
  const paymentMethod = (firstDetails.payment_method as string | null) ?? "bank_transfer"
  const creditCardInvoiceEmail = (firstDetails.credit_card_invoice_email as string | null) ?? null

  const payload: GroupRegistrationPdfPayload = {
    generatedFor: divers.find(d => d.name)?.name ?? "the group",
    leadEmail:    callerEmail ?? "",
    paymentMethod,
    creditCardInvoiceEmail,
    groupTotal,
    groupDeposit: allHaveDeposit ? groupDeposit : null,
    fullPaymentDeadline: null,
    divers,
  }

  if (deps.transporter) {
    try {
      const base64 = await deps.buildGroupPdfBase64(payload)
      const buf = Buffer.from(base64, "base64")
      const subject = `group registration--${divers.length} divers--${payload.generatedFor}`
      const attach = { filename: "group-registration.pdf", content: buf, contentType: "application/pdf" }
      const fromHeader = { name: deps.env.mailFromName, address: deps.env.mailFromAddress }
      await deps.transporter.sendMail({
        from: fromHeader, subject, to: deps.env.companyEmail,
        text: "Group registration summary attached.",
        attachments: [attach],
      })
      if (callerEmail && callerEmail.toLowerCase().trim() !== deps.env.companyEmail) {
        await deps.transporter.sendMail({
          from: fromHeader, subject, to: callerEmail,
          text:
            "Thanks for registering your group — a single summary covering everyone is attached.\n\n" +
            `Once you've sent payment, please let us know via email, LINE, or WhatsApp so we can confirm receipt — contact details are in the attached PDF.\n\n— ${siteConfig.identity.shopName}`,
          attachments: [attach],
        })
      }
    } catch (e) {
      console.error("group summary email failed:", (e as Error).message)
    }
  }

  return json({ ok: true, divers: divers.length, group_total: groupTotal })
}
