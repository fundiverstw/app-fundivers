import { siteConfig } from '../config/site'

// A fill-in-the-details starting point for a shop that has no Terms yet.
//
// English only, on purpose. Everything else the app shows is translated, but a
// Terms of Use is a legal document: a machine translation of one is not the same
// document, and shipping three "equivalent" versions invites the question of
// which one a diver actually agreed to. A shop writes (or has drafted) its own
// terms in its own language and pastes them in; this template exists so nobody
// starts from a blank page.
//
// Every clause a shop must decide for itself is marked TODO. The admin editor
// refuses to publish nothing, but it cannot know a TODO is unanswered — see the
// disclaimer at the top of the template, which is meant to be deleted.

export function starterTermsTemplate(): string {
  const { shopName } = siteConfig.identity
  const { email } = siteConfig.contact
  const today = new Date().toISOString().slice(0, 10)

  return `> **Delete this block before publishing.** This is a starting point, not
> legal advice. Replace every TODO, and have a lawyer read it before you rely on
> it. Bump the version (tick "material change") whenever the substance changes.

# Terms of Use & Privacy

Last updated: ${today}

## Who we are

${shopName} ("we", "us"). You can reach us at ${email}.

## What this app does

You use this app to register for dives and courses, keep a dive log, and manage
your bookings and payments with us.

## What we collect, and why

- **Account details** — name, email, contact handle. To identify you and get in
  touch about your bookings.
- **Diving details** — certification level, logged dives, medical notes you
  choose to share. To keep you safe in the water and meet operator requirements.
- **Booking and payment records** — what you booked and what you paid. To run
  the business and meet our accounting obligations.
- TODO: list anything else you collect (photos, ID numbers, emergency contacts).

We do not sell your data.

## Who we share it with

- Dive partners and boat operators, where a dive requires it (for example, a
  passenger manifest).
- TODO: name any other processor you use (payments, email, hosting).

## How long we keep it

TODO: state your retention period, and what happens when an account is deleted.

## Your rights

You can ask us to export or delete your data at any time by writing to
${email}. TODO: state the law you operate under and any rights it grants.

## Liability and safety

Diving carries inherent risk. Nothing in this app replaces the waivers and
briefings you complete with us. TODO: state your liability position.

## Changes to these terms

When we make a material change we will ask you to accept the new version the
next time you open the app.

## Governing law

These terms are governed by the laws of TODO_JURISDICTION.
`
}
