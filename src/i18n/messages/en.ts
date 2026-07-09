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
    cancel: 'Cancel',
    continue: 'Continue',
    register: 'Register',
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
  dashboard: {
    poweredByGithub: 'fundive on GitHub',
    releaseNotes: (version: string) => `fundive ${version} release notes`,
    featuredTrips: 'Featured trips',
    waitlist: 'waitlist',
  },
  calendar: {
    typeDive: 'Dive',
    typeCourse: 'Course',
    registerMultiple: 'Register for multiple events',
    multiModeHint: "Multi-event mode — tap events to add. Already-booked or full events can't be added.",
    booked: 'Booked',
    full: 'Full',
    added: 'Added',
    add: '+ Add',
    eventsSelected: (n: number) => `${n} event${n === 1 ? '' : 's'} selected`,
    priceFrom: (amount: string) => `From ${amount}`,
    cancelBooking: 'Cancel booking',
    shareWithFriends: 'Share link with friends',
    busy: 'Busy',
    private: 'Private',
    thisMonth: 'This month',
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
    noEvents: 'No events scheduled.',
    alreadyHappened: (title: string) => `${title} — already happened`,
    noCoursesInRange: 'No courses in this range.',
    toggleDives: 'Toggle dives',
    filterCourses: 'Filter courses',
    courses: 'Courses',
    toggleAvailability: 'Toggle staff availability',
    weekdays: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
    moveEventDay: 'Move event day',
    moveIt: 'Move it',
    rescheduleConfirm: (name: string, from: string, to: string) => `Change ${name} from ${from} to ${to}?`,
    eventDetails: {
      description: 'About this event',
      included: "What's included",
      notIncluded: 'Not included',
      schedule: 'Schedule / itinerary',
      transportation: 'Transportation',
      prerequisites: 'Prerequisites',
      minCert: (cert: string) => `Minimum certification: ${cert}`,
      loggedDives: (n: number) => `Logged dives: ${n}+`,
    },
  },
}

/** The shape every locale catalog must satisfy, inferred from English. */
export type Messages = typeof en
