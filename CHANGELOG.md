# Changelog

All notable changes to FunDive are recorded here. FunDive follows
[semantic versioning](https://semver.org/): releases are tagged
`vMAJOR.MINOR.PATCH`, and forks track them by tag (see
[docs/forking.md](docs/forking.md)).

## [0.1.0] — 2026-07-05

First public, forkable release of **FunDive** — the free, open-source,
self-hostable dive-center platform (bookings, courses, payments, dive logs,
fleet ride logistics, trusted-partner referrals, and staff operations).
Licensed **AGPL-3.0-or-later**.

Notable capabilities in this release:

- **Config seam.** Every shop-specific value lives in `fundive.config.ts`,
  validated against a typed contract (`src/config/site.ts`) at build time — a
  fork customizes one file and never edits core.
- **Registration.** Resumable multi-step form (local-draft autosave + resume
  shortcut), a certification-declaration gate with a deferrable card photo,
  event-prerequisite acknowledgment, and automatic retry on dropped submits.
- **Fleet.** Physical-seat ride planning that reserves one driver seat per
  vehicle in the ride-claim capacity, with no per-vehicle driver assignment.
- **Trusted partners.** A partner directory with in-app diver-to-partner
  messaging routed through the shop's email.

## Config contract (`configVersion`)

`fundive.config.ts` declares a `configVersion` that must equal core's
`CONFIG_CONTRACT_VERSION` (`src/config/site.ts`). When core changes the config
shape in a way forks must adopt, it bumps that number and the build fails until
your config migrates. Each bump's required change is listed here.

### 4 — current (v0.1.0)

- **Add** `business.nitroxCourseFee: number` — the flat fee to add a Nitrox
  course to a dive registration, in the shop currency (previously hardcoded in
  core). Set it to your shop's price.

Versions 1–3 predate the first public release; there were no external forks to
migrate, so their deltas aren't tracked here. New forks should start from
`fundive.config.example.ts`, which always ships at the current contract version.
