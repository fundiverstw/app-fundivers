import { useAuth } from '../hooks/useAuth'
import { Logo } from '../components/Logo'
import { CARD_ELEVATED, BTN_PRIMARY, TEXT_MUTED } from '../styles/tokens'
import { useShopContact } from '../hooks/useShopContact'
import { t } from '../i18n'

// Where a diver lands when their profile is not 'active'.
//
// This used to be the last step of signing up: every new account started at
// 'pending', RequireActive parked it here, and the page showed the whole
// profile form plus a list of what was still blank, on the theory that a
// fuller profile would be approved sooner. Divers read it as the site being
// broken — they had signed up, agreed to the terms, and still could not see a
// calendar. Accounts are active from creation now (20260831120000).
//
// So nobody arrives here by signing up any more. The only way in is an admin
// moving a live profile to 'pending' or 'rejected' by hand, which is a
// suspension. The page says that and offers the shop's address, because the
// one useful action for a suspended account is talking to a human — a profile
// form would only imply that filling it in changes something.
export function PendingPage() {
  const { contact } = useShopContact()
  const { profile, signOut } = useAuth()
  const rejected = profile?.status === 'rejected'

  return (
    <div className="min-h-screen bg-brand-900 p-4">
      <div className="w-full max-w-lg mx-auto space-y-4">
        <div className="flex justify-center"><Logo size="lg" /></div>

        <div className={`${CARD_ELEVATED} p-6 text-center`}>
          <h1 className="text-xl font-semibold text-brand-950 mb-2">
            {rejected ? t.pending.rejectedTitle : t.pending.holdTitle}
          </h1>
          <p className={`${TEXT_MUTED} text-sm mb-5`}>
            {rejected ? t.pending.rejectedBodyPrefix : t.pending.holdBodyPrefix}
            {contact.email && (
              <>
                {' '}
                <a href={`mailto:${contact.email}`} className="underline">
                  {contact.email}
                </a>
              </>
            )}{t.pending.rejectedBodySuffix}
          </p>
          <button onClick={signOut} className={`w-full ${BTN_PRIMARY}`}>
            {t.common.signOut}
          </button>
        </div>
      </div>
    </div>
  )
}
