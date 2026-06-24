// send-group-summary — Deno entry. Business logic lives in handler.ts so
// vitest can unit-test it from Node with mocked deps. This file builds the
// production deps (real supabase-js admin client, real nodemailer, real
// group PDF builder) and forwards the Request to the handler.

import { createClient } from "jsr:@supabase/supabase-js@2.103.2"
import nodemailer from "npm:nodemailer@6.9.14"
import { buildGroupPdfBase64 } from "../_shared/pdf.ts"
import { handleGroupSummary, type Deps } from "./handler.ts"

const COMPANY_EMAIL = "fundiverstw@gmail.com"

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!
  const GMAIL_USER   = Deno.env.get("GMAIL_USER")
  const GMAIL_PASS   = Deno.env.get("GMAIL_APP_PASSWORD")

  if (req.method === "POST" && (!GMAIL_USER || !GMAIL_PASS)) {
    return new Response(
      JSON.stringify({ error: "GMAIL_USER and GMAIL_APP_PASSWORD must be set (supabase secrets set)" }),
      { status: 500, headers: { "content-type": "application/json" } },
    )
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const deps: Deps = {
    admin,
    makeAuthedClient: (token) => createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth:   { persistSession: false },
    }),
    transporter: (GMAIL_USER && GMAIL_PASS) ? nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    }) : null,
    buildGroupPdfBase64,
    env: {
      companyEmail:    COMPANY_EMAIL,
      mailFromName:    "FunDivers TW",
      mailFromAddress: GMAIL_USER ?? "",
    },
  }

  return handleGroupSummary(req, deps)
})
