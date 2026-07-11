// Builds a one-page "signed waiver record" PDF for a single waiver_signatures
// row: the waiver title + the archived content the diver saw, plus an
// e-signature attestation block (who, when, version, SHA-256). Text waivers
// render their body; uploaded-PDF waivers render a pointer note (the original
// form PDF is shipped alongside in the ZIP); pre-snapshot signatures render a
// "content not archived" note.
//
// Server-side because the embedded CJK font is too large for the SPA bundle —
// same reason the registration PDF lives here. Mirrors pdf.ts's font handling.

import { jsPDF } from "npm:jspdf@2.5.1";
import { Buffer } from "node:buffer";
import { needsCjkFont } from "./pdf-fonts.ts";

const CJK_FONT_PATH = new URL("./pdf-cjk.ttf", import.meta.url);
const CJK_FAMILY = "NotoCJK";
const CJK_VFS_NAME = "pdf-cjk.ttf";

let cjkFontB64: Promise<string | null> | null = null;
function loadCjkFontB64(): Promise<string | null> {
  cjkFontB64 ??= Deno.readFile(CJK_FONT_PATH)
    .then((bytes) => Buffer.from(bytes).toString("base64"))
    .catch(() => null);
  return cjkFontB64;
}

export interface WaiverRecord {
  title: string;
  code: string;
  version: number;
  signedName: string;
  signedAt: string; // ISO
  diverLabel: string; // name / email / id
  body: string | null; // text-waiver markdown snapshot
  pdfPath: string | null; // uploaded-PDF snapshot path
  sha256: string | null;
}

/** Returns the base64 of a single-page A4 record PDF. */
export async function buildWaiverRecordPdfBase64(r: WaiverRecord): Promise<string> {
  const allText = [r.title, r.signedName, r.diverLabel, r.body ?? ""].join(" ");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });

  const hasCjk = needsCjkFont(allText);
  if (hasCjk) {
    const b64 = await loadCjkFontB64();
    if (b64) {
      doc.addFileToVFS(CJK_VFS_NAME, b64);
      doc.addFont(CJK_VFS_NAME, CJK_FAMILY, "normal");
    }
  }
  const font = (text: string, style: "normal" | "bold") => {
    if (hasCjk && needsCjkFont(text)) doc.setFont(CJK_FAMILY, "normal");
    else doc.setFont("helvetica", style);
  };

  const ML = 15;
  const MR = 195;
  const WIDTH = MR - ML;
  let y = 22;

  doc.setFontSize(16);
  font(r.title, "bold");
  for (const line of doc.splitTextToSize(r.title, WIDTH) as string[]) {
    doc.text(line, ML, y);
    y += 8;
  }

  doc.setDrawColor(180);
  doc.line(ML, y, MR, y);
  y += 8;

  // Attestation block.
  const rows: [string, string][] = [
    ["Signed by", r.signedName],
    ["Account", r.diverLabel],
    ["Signed at", new Date(r.signedAt).toISOString().replace("T", " ").slice(0, 19) + " UTC"],
    ["Waiver version", String(r.version)],
    ["Content SHA-256", r.sha256 ?? "(not archived)"],
  ];
  doc.setFontSize(10);
  for (const [label, value] of rows) {
    font(label, "bold");
    doc.text(label, ML, y);
    font(value, "normal");
    for (const line of doc.splitTextToSize(value, WIDTH - 45) as string[]) {
      doc.text(line, ML + 45, y);
      y += 5.5;
    }
    y += 1.5;
  }

  y += 4;
  doc.setDrawColor(210);
  doc.line(ML, y, MR, y);
  y += 8;

  // Content.
  doc.setFontSize(11);
  const content = r.body
    ? r.body
    : r.pdfPath
    ? "This waiver was an uploaded PDF form. The original signed form is included alongside this record in the export."
    : "The content of this waiver was not archived at signing time (it was signed before content snapshotting was enabled). This record attests the signature; the version above identifies the document.";
  for (const para of content.replace(/\r\n?/g, "\n").split("\n")) {
    if (!para.trim()) { y += 4; continue; }
    font(para, "normal");
    for (const line of doc.splitTextToSize(para, WIDTH) as string[]) {
      if (y > 285) { doc.addPage(); y = 20; }
      doc.text(line, ML, y);
      y += 5.5;
    }
  }

  const uri = doc.output("datauristring") as string;
  return uri.slice(uri.indexOf("base64,") + 7);
}
