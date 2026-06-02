// Authoritative version of the Terms of Use & Privacy text shown at
// /terms (src/pages/TermsPage.tsx). When the text changes materially,
// bump this number. RequireCurrentTerms compares it against the user's
// profiles.agreed_to_terms_version on every protected navigation;
// stale users get bounced to /terms?reaccept=1 until they re-consent
// via the accept_current_terms RPC.
//
// Bump policy: any non-cosmetic change (new data category, new
// retention rule, jurisdictional clause, etc.) — bump. Pure typo /
// rewording — do not bump.
//
// Database side:
//   - handle_new_user trigger (20260603000000_terms_consent_versioning.sql)
//     stores whatever value this file sends at signup.
//   - accept_current_terms RPC stores whatever value the SPA passes for
//     re-acceptance.
// The server doesn't enforce a maximum — see the legal-brief for the
// non-repudiation tradeoff. The SPA is the source of truth for "what
// version is currently shown to users."
export const CURRENT_TERMS_VERSION = 1
