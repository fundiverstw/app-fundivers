// English message catalog — the source of truth for the app's shop-facing UI
// text. Its inferred type (`Messages`) is the contract every other locale is
// checked against: a missing or misnamed key fails the TypeScript build.
//
// Rules for this file and its sibling catalogs:
//   - Pure data / plain functions only. No imports from src/config or React, so
//     a catalog stays portable to the Deno edge-function runtime.
//   - Strings needing a runtime value are functions; the parameter names and
//     types propagate to every translation through the shared `Messages` type.
//   - Do NOT add `as const` — values must widen to `string` so a translated
//     catalog can supply a different literal for the same key.
// See docs/i18n.md.

export const en = {
  nav: {
    calendar: 'Calendar',
    records: 'Records',
    profile: 'Profile',
    contact: 'Contact',
    duty: 'Duty',
    logistics: 'Logistics',
    divers: 'Divers',
    manage: 'Manage',
  },
  common: {
    signOut: 'Sign out',
  },
  shell: {
    trustedPartners: 'Trusted Partners',
    packages: 'Packages',
    scheduledTrips: 'Scheduled Trips',
    home: 'Home',
    radio: (shop: string) => `${shop} Radio`,
    installApp: 'Install app',
    adminHome: 'Admin home',
    pending: (n: number) => `${n} pending`,
    pendingApplications: (n: number) => `${n} pending applications`,
  },
}

/** The shape every locale catalog must satisfy, inferred from English. */
export type Messages = typeof en
