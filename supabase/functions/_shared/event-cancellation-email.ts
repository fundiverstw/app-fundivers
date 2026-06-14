// Pure builder for the event-cancellation email. Kept apart from index.ts
// so it's vitest-importable (index.ts uses jsr:/npm: specifiers). See
// create-registration/handler.ts for the same split.

export function buildCancellationEmail(eventTitle: string): { subject: string; text: string } {
  const title = eventTitle.trim() || 'your dive'
  return {
    subject: `Cancelled: ${title}`,
    text: [
      'Hi,',
      '',
      `We're sorry to let you know that ${title} has been cancelled.`,
      '',
      'If you paid a deposit or the full amount, the shop will be in touch about a refund or rebooking. Reply to this email or contact us on LINE / WhatsApp with any questions.',
      '',
      '— FunDivers TW',
    ].join('\n'),
  }
}
