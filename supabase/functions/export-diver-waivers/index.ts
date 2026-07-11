// export-diver-waivers — admin-only. Builds a ZIP of a diver's signed-waiver
// records: one attestation PDF per signature (content snapshot + e-signature
// block with SHA-256), plus the original uploaded form PDF for any PDF-form
// waiver. Returned as base64 for the SPA to download.
//
// Body: { diver_id: string }
// Returns: 200 { ok: true, count, filename, zip_base64 }
//          200 { ok: true, count: 0 } when the diver has signed nothing
//          400 / 401 / 403 on bad input / auth / non-admin.

import { createClient } from "jsr:@supabase/supabase-js@2.103.2";
import { zipSync } from "npm:fflate@0.8.3";
import { Buffer } from "node:buffer";
import { corsOk, jsonResponse, bearerToken, safeError } from "../_shared/responses.ts";
import { buildWaiverRecordPdfBase64 } from "../_shared/waiver-record-pdf.ts";

const WAIVER_PDF_BUCKET = "waiver-pdfs";

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === "OPTIONS") return corsOk(req);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json({ error: "unauthorized" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  try {
    // Identify the caller from their JWT, then confirm admin via service role.
    const authed = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userRes } = await authed.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) return json({ error: "unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: me } = await admin.from("profiles").select("role").eq("id", uid).single();
    if (me?.role !== "admin") return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const diverId = typeof body?.diver_id === "string" ? body.diver_id : null;
    if (!diverId) return json({ error: "diver_id required" }, 400);

    const { data: diver } = await admin
      .from("profiles").select("name, email").eq("id", diverId).single();
    const { data: sigs } = await admin
      .from("waiver_signatures")
      .select("waiver_code, waiver_version, signed_name, signed_at, signed_title, signed_body, signed_pdf_path, content_sha256")
      .eq("diver_id", diverId)
      .order("signed_at", { ascending: true });

    if (!sigs || sigs.length === 0) return json({ ok: true, count: 0 }, 200);

    const diverLabel = diver?.name || diver?.email || diverId;
    const files: Record<string, Uint8Array> = {};

    for (const s of sigs) {
      const b64 = await buildWaiverRecordPdfBase64({
        title: s.signed_title || s.waiver_code,
        code: s.waiver_code,
        version: s.waiver_version,
        signedName: s.signed_name,
        signedAt: s.signed_at,
        diverLabel,
        body: s.signed_body,
        pdfPath: s.signed_pdf_path,
        sha256: s.content_sha256,
      });
      const base = `${s.waiver_code}-v${s.waiver_version}`;
      files[uniqueName(files, `${base}.pdf`)] = new Uint8Array(Buffer.from(b64, "base64"));

      if (s.signed_pdf_path) {
        const { data: file } = await admin.storage.from(WAIVER_PDF_BUCKET).download(s.signed_pdf_path);
        if (file) files[uniqueName(files, `${base}-form.pdf`)] = new Uint8Array(await file.arrayBuffer());
      }
    }

    const zipped = zipSync(files);
    const zipB64 = Buffer.from(zipped).toString("base64");
    const safeLabel = String(diverLabel).replace(/[^\w.-]+/g, "_").slice(0, 60) || "diver";
    return json({ ok: true, count: sigs.length, filename: `waivers-${safeLabel}.zip`, zip_base64: zipB64 }, 200);
  } catch (err) {
    return json({ error: safeError(err, "could not build the waiver export") }, 500);
  }
});

// A diver may sign the same waiver code more than once (re-sign on a version
// bump); keep every record by disambiguating collisions.
function uniqueName(files: Record<string, unknown>, name: string): string {
  if (!(name in files)) return name;
  const dot = name.lastIndexOf(".");
  const stem = name.slice(0, dot);
  const ext = name.slice(dot);
  let n = 2;
  while (`${stem}-${n}${ext}` in files) n++;
  return `${stem}-${n}${ext}`;
}
