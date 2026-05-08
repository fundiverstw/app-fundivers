import { Permissions, webMethod } from 'wix-web-module';
import wixSecretsBackend from 'wix-secrets-backend';
import { fetch } from 'wix-fetch';
import { jsPDF } from 'jspdf';
import nodemailer from 'nodemailer';
const COMPANY_EMAIL = 'fundiverstw@gmail.com';
const LOGO_URL =
  'https://static.wixstatic.com/media/b37fef_ade8b006d798481a89453869bbc7aee6~mv2.png/v1/fill/w_400,h_240,al_c,q_85,enc_auto/b37fef_ade8b006d798481a89453869bbc7aee6~mv2.png';

// Brand colours matching registration-form-2026-eng.tex
const C = {
  ocean:      [11,  83,  148],   // #0B5394
  oceanLight: [214, 233, 248],   // #D6E9F8
  oceanBg:    [238, 245, 251],   // #EEF5FB
  dark:       [26,  26,  26],    // #1A1A1A
  gray:       [110, 110, 110],
  white:      [255, 255, 255]
};

// Margins
const ML = 10; // left
const MR = 200; // right edge (210 - 10)
const COL = 68; // value column start

function formatGeneratedDate() {
  const d = new Date();
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function ensureY(doc, y, reserveMm) {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + reserveMm > pageH - 12) { doc.addPage(); return 18; }
  return y;
}

// Full-width ocean bar section header matching \formheader
function section(doc, y, title) {
  y = ensureY(doc, y, 22);
  doc.setFillColor(...C.ocean);
  doc.rect(0, y, 210, 8, 'F');
  doc.setTextColor(...C.white);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(8.5);
  doc.text(title.toUpperCase(), ML + 2, y + 5.5);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...C.dark);
  return y + 11;
}

// Two-column field row with alternating oceanbg / white background
let _rowAlt = false;
function resetRows() { _rowAlt = false; }
function row(doc, y, label, value) {
  if (value === undefined || value === null || value === '' || value === false) return y;
  const v = String(value);
  const ROW_H = 7;
  const wrapped = doc.splitTextToSize(v, MR - COL);
  const blockH = ROW_H + (wrapped.length > 1 ? (wrapped.length - 1) * 4.5 : 0);
  y = ensureY(doc, y, blockH);
  doc.setFillColor(...(_rowAlt ? C.oceanBg : C.white));
  doc.rect(0, y - 5, 210, blockH, 'F');
  _rowAlt = !_rowAlt;
  doc.setFontSize(8.5);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...C.gray);
  doc.text(label, ML + 2, y);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...C.dark);
  for (let i = 0; i < wrapped.length; i++) doc.text(wrapped[i], COL, y + i * 4.5);
  return y + blockH;
}

async function fetchLogoDataUrl() {
  try {
    const res = await fetch(LOGO_URL);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
    const b64 = Buffer.from(buf).toString('base64');
    if (ct.includes('jpeg') || ct.includes('jpg')) return { dataUrl: 'data:image/jpeg;base64,' + b64, format: 'JPEG' };
    return { dataUrl: 'data:image/png;base64,' + b64, format: 'PNG' };
  } catch {
    return null;
  }
}

async function buildPdfBase64(p) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  resetRows();

  // ── Header (centred, matching LaTeX) ──────────────────
  const logo = await fetchLogoDataUrl();
  let y = 8;

  // Generated date top-right
  doc.setFontSize(7.5);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...C.gray);
  doc.text('Generated: ' + formatGeneratedDate(), MR, y, { align: 'right' });
  y += 5;

  // Logo centred
  if (logo) {
    try {
      const logoW = 38, logoH = 23;
      doc.addImage(logo.dataUrl, logo.format, (210 - logoW) / 2, y, logoW, logoH);
      y += logoH + 3;
    } catch (_) { y += 4; }
  }

  // Tagline
  doc.setFontSize(8.5);
  doc.setFont(undefined, 'italic');
  doc.setTextColor(...C.ocean);
  doc.text('Breathe the Adventure! Explore with Confidence!', 105, y, { align: 'center' });
  y += 6;

  // Title
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...C.ocean);
  doc.text('Registration Form', 105, y, { align: 'center' });
  y += 4;

  // Horizontal rule
  doc.setDrawColor(...C.ocean);
  doc.setLineWidth(0.5);
  doc.line(ML, y, MR, y);
  y += 6;

  // ── Event ─────────────────────────────────────────────
  resetRows();
  y = section(doc, y, 'Event');
  y = row(doc, y, 'Event', p.eventTitle);
  y = row(doc, y, 'Date', p.startDate ? (p.startDate + (p.endDate && p.endDate !== p.startDate ? ' to ' + p.endDate : '')) : '');
  y += 4;

  // ── Personal details ──────────────────────────────────
  resetRows();
  y = section(doc, y, 'Personal details');
  y = row(doc, y, 'Name', p.name);
  y = row(doc, y, 'Email', p.email);
  y = row(doc, y, 'Date of birth', p.dob);
  y = row(doc, y, 'Nationality', p.nationality);
  y = row(doc, y, 'Passport / ARC', p.idNumber);
  y = row(doc, y, 'Contact', p.contactMethod ? (p.contactMethod + (p.contactId ? ' - ' + p.contactId : '')) : '');
  y += 4;

  // ── Certification ─────────────────────────────────────
  if (p.certLevel || p.certOrg || p.loggedDives || p.lastDiveDate) {
    resetRows();
    y = section(doc, y, 'Certification');
    y = row(doc, y, 'Level', p.certLevel);
    y = row(doc, y, 'Organization', p.certOrg);
    y = row(doc, y, 'Nitrox certified', p.diverNitrox ? 'Yes' : '');
    y = row(doc, y, 'Nitrox course add-on', p.addNitroxCourse ? 'Yes' : '');
    y = row(doc, y, 'Logged dives', p.loggedDives);
    y = row(doc, y, 'Last dive', p.lastDiveDate);
    y += 4;
  }

  // ── Accommodation & extras ────────────────────────────
  resetRows();
  y = section(doc, y, 'Accommodation & extras');
  y = row(doc, y, 'Room upgrade', p.roomBoard);
  y = row(doc, y, 'Room requests', p.roomNotes);
  if (p.otherAddons && p.otherAddons.length) {
    y = row(doc, y, 'Other add-ons', p.otherAddons.join(', '));
  }
  const gearDays = p.diveDays && p.diveDays > 1 ? p.diveDays : 1;
  const gearLabel = p.rentGear ? (p.gearMode === 'full' ? 'Full set' : 'A-la-carte') + (gearDays > 1 ? ' x' + gearDays + ' days' : '') : 'No';
  y = row(doc, y, 'Gear rental', gearLabel);
  if (p.rentGear && p.gearItems && p.gearItems.length) y = row(doc, y, 'Items', p.gearItems.join(', '));
  if (p.rentGear && (p.height || p.weight || p.shoeSize)) {
    y = row(doc, y, 'Sizing', 'H: ' + (p.height || '') + '  W: ' + (p.weight || '') + '  Shoe: ' + (p.shoeSize || ''));
  }
  y = row(doc, y, 'Transportation', p.needsRide ? 'Yes' : 'No');
  if (p.notes) y = row(doc, y, 'Note', p.notes);
  y += 4;

  // ── Payment ───────────────────────────────────────────
  resetRows();
  y = section(doc, y, 'Payment');
  const methodLabel = p.paymentMethod === 'bank' ? 'Bank transfer' : p.paymentMethod === 'paypal' ? 'Credit card / PayPal' : p.paymentMethod === 'cash' ? 'Cash' : (p.paymentMethod || '');
  y = row(doc, y, 'Method', methodLabel);
  y = row(doc, y, 'Deposit due (NTD)', p.deposit);
  y += 2;

  // Total highlighted row (matching LaTeX bold emphasis)
  y = ensureY(doc, y, 14);
  doc.setFillColor(...C.oceanLight);
  doc.rect(0, y - 5, 210, 10, 'F');
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...C.ocean);
  doc.text('Total (NTD)', ML + 2, y + 1);
  doc.setFontSize(13);
  doc.text(p.total != null ? String(p.total) : '-', COL, y + 1);

  const base64 = doc.output('datauristring').split(',')[1];
  return base64;
}

async function getTransporter() {
  const user = await wixSecretsBackend.getSecret('GMAIL_USER');
  const pass = await wixSecretsBackend.getSecret('GMAIL_APP_PASSWORD');
  if (!user || !pass) throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be set in Secrets');
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass }
  });
}

export const sendRegistrationPdf = webMethod(
  Permissions.Anyone,
  async (payload) => {
    const registrantEmail = payload && payload.email;
    if (!registrantEmail) throw new Error('No email in payload');

    const subject = 'Registration' + (payload.eventTitle ? ' - ' + payload.eventTitle : '') + ' | Fundivers TW';
    const base64 = await buildPdfBase64(payload);
    const transporter = await getTransporter();
    const from = await wixSecretsBackend.getSecret('GMAIL_USER');
    const buf = Buffer.from(base64, 'base64');
    const mailOpts = {
      from: { name: 'Fundivers TW', address: from },
      subject,
      text: 'Registration summary attached.',
      attachments: [{ filename: 'registration.pdf', content: buf, contentType: 'application/pdf' }]
    };
    await transporter.sendMail({ ...mailOpts, to: COMPANY_EMAIL });
    if (registrantEmail.toLowerCase().trim() !== COMPANY_EMAIL.toLowerCase()) {
      await transporter.sendMail({ ...mailOpts, to: registrantEmail, text: 'Please find your registration summary attached.' });
    }
  }
);
