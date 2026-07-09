// Post-submit "What happens next" summary. This is the concise replacement
// for the payment-confirmation reminders that used to sit on the registration
// form's payment step — divers read it after they submit (the inline modal
// confirmation and the standalone RegisterPage success screen), when it
// actually matters, instead of wading through it while filling the form.
import { t } from '../../i18n'

export function WhatHappensNext({ waitlisted = false }: { waitlisted?: boolean }) {
  return (
    <div className="text-sm text-brand-950 font-medium bg-surface-50 border border-surface-200 rounded-lg p-3 space-y-2 text-left">
      <p className="font-semibold text-brand-900">{t.register.nextSteps.title}</p>
      <ul className="list-disc list-outside pl-5 space-y-1">
        {waitlisted ? (
          <li>{t.register.nextSteps.waitlisted}</li>
        ) : (
          <>
            <li>
              {t.register.nextSteps.emailedSummary}{' '}
              <strong>{t.register.nextSteps.checkSpam}</strong> {t.register.nextSteps.ifNotInbox}
            </li>
            <li>
              {t.register.nextSteps.payDeposit1} <strong>{t.register.nextSteps.payDepositAsap}</strong> {t.register.nextSteps.payDeposit2}
            </li>
            <li>{t.register.nextSteps.afterYouPay}</li>
          </>
        )}
        <li>{t.register.nextSteps.trackStatus}</li>
      </ul>
    </div>
  )
}
