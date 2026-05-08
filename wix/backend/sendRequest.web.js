// Visitor-submitted requests from the home page #requestHtml iframe.
// Same Gmail SMTP path as sendRegistrationPdf.web.js — credentials live in
// Wix Secrets (GMAIL_USER / GMAIL_APP_PASSWORD).

import { Permissions, webMethod } from 'wix-web-module';
import wixSecretsBackend from 'wix-secrets-backend';
import nodemailer from 'nodemailer';

const COMPANY_EMAIL = 'fundiverstw@gmail.com';

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

export const sendRequest = webMethod(
  Permissions.Anyone,
  async (payload) => {
    const requestType = payload && payload.requestType;
    const name        = payload && payload.name && String(payload.name).trim();
    const email       = payload && payload.email && String(payload.email).trim();
    const message     = payload && payload.message && String(payload.message).trim();

    if (!name || !email || !message) throw new Error('Missing required fields');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email');

    const label = requestType === 'try-dive' ? 'Try-Dive Request' : 'Course Request';
    const subject = `${label} from ${name}`;
    const text =
      `Request type: ${label}\n` +
      `Name: ${name}\n` +
      `Email: ${email}\n\n` +
      `Message:\n${message}\n`;

    const transporter = await getTransporter();
    const from = await wixSecretsBackend.getSecret('GMAIL_USER');

    await transporter.sendMail({
      from: { name: 'Fundivers TW Site', address: from },
      to: COMPANY_EMAIL,
      replyTo: email,
      subject,
      text
    });
  }
);
