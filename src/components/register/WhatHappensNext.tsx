// Post-submit "What happens next" summary. This is the concise replacement
// for the payment-confirmation reminders that used to sit on the registration
// form's payment step — divers read it after they submit (the inline modal
// confirmation and the standalone RegisterPage success screen), when it
// actually matters, instead of wading through it while filling the form.
export function WhatHappensNext({ waitlisted = false }: { waitlisted?: boolean }) {
  return (
    <div className="text-sm text-brand-950 font-medium bg-surface-50 border border-surface-200 rounded-lg p-3 space-y-2 text-left">
      <p className="font-semibold text-brand-900">What happens next</p>
      <ul className="list-disc list-outside pl-5 space-y-1">
        {waitlisted ? (
          <li>If a spot opens up we'll email and notify you — you'll have 24 hours to claim it. No payment is needed until then.</li>
        ) : (
          <>
            <li>
              We've emailed your registration summary.{' '}
              <strong>Check your spam or junk folder</strong> if it's not in your inbox.
            </li>
            <li>
              Pay your deposit <strong>as soon as possible</strong> to hold your spot — your
              booking is confirmed once we receive payment.
            </li>
            <li>After you pay, message us by email, LINE, or WhatsApp so we can confirm receipt.</li>
          </>
        )}
        <li>Track your status and payments any time in the app.</li>
      </ul>
    </div>
  )
}
