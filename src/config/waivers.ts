import type { CourseColor } from '../lib/event-colors'

// ─────────────────────────────────────────────────────────────────────────────
// Waiver catalog — the deployment customization point.
//
// FunDive is open source: each shop that adopts it sets its own waivers here.
// This file is the single source of truth for the GLOBAL rules — what each
// waiver says, how often it must be re-signed, and which events require it.
// Per-event exceptions (require/exempt a waiver on one specific dive or course)
// are layered on top in the database via `event_waivers`, edited from the admin
// Edit-event form. The two combine in src/lib/waivers.ts.
//
// Adding / changing a waiver:
//   - Add or edit an entry below. Bodies are shown verbatim to the diver before
//     they e-sign, so keep the text faithful to the source form.
//   - Bump `version` when the text changes — every diver is then asked to
//     re-sign (mirrors CURRENT_TERMS_VERSION for the Terms of Use). `code` is a
//     stable key written into each signature row and must never be reused for a
//     different waiver.
// ─────────────────────────────────────────────────────────────────────────────

export type WaiverCadence =
  /** One signature covers every qualifying event for a year from signing. */
  | 'annual'
  /** A fresh signature is required for each event (tied to that dive/course). */
  | 'per_event'

// 'none' keeps a waiver in the catalog — voluntarily signable, and requirable on
// individual events via an event_waivers 'require' override — without any global
// rule auto-requiring it. Use it for forms a shop offers but doesn't mandate.
export type WaiverAppliesTo = 'dives' | 'courses' | 'all' | 'none'

export interface WaiverDef {
  /** Stable identifier stored on signatures/overrides — never reuse for a
   *  different waiver. */
  code: string
  title: string
  cadence: WaiverCadence
  /** Bump to force everyone to re-sign the next time they hit a qualifying
   *  event or open My Waivers. */
  version: number
  appliesTo: WaiverAppliesTo
  /** When courses are in scope, restrict to these classifier buckets (from
   *  courseColor()). Omit to apply to every course. Ignored for `dives`. */
  courseColors?: CourseColor[]
  /** Shown to the diver to read before signing. */
  body: string
}

const PADI_LIABILITY_BODY = `BOAT TRAVEL AND SCUBA DIVING LIABILITY RELEASE AND ASSUMPTION OF RISK AGREEMENT

I hereby affirm that I am a certified scuba diver or a student diver under the control and supervision of a certified scuba instructor, and that I thoroughly understand the hazards of scuba diving including those occurring during boat travel to and from the dive site (the "Excursion").

I understand that these inherent risks include, but are not limited to, drowning, air expansion injuries, decompression sickness, embolism or other hyperbaric injuries that require treatment in a recompression chamber; slipping or falling while on board; being cut or struck by a boat while in the water; injuries occurring while getting on or off a boat; and other perils of the sea — all of which can result in serious injury or death. I understand the Excursion will be conducted at a site that is remote, by time or distance or both, from a recompression chamber and emergency medical facilities. I still choose to proceed.

I understand and agree that neither the divemaster/dive supervisor/instructor; nor the crew or owner of the vessel; nor the vessel itself; nor PADI Americas, Inc., nor its affiliate or subsidiary corporations; nor the owners, officers, employees, agents, contractors or assigns of the above (the "Released Parties") may be held liable or responsible in any way for any personal injury, property damage, wrongful death or other damages to me or my family, estate, heirs or assigns that may occur as a result of my participation in this Excursion, or as a result of the negligence of any party, including the Released Parties, whether passive or active.

I affirm I am in good mental and physical fitness to scuba dive and am not under the influence of alcohol or any drugs contraindicated to diving. I affirm it is my responsibility to inspect my equipment prior to the Excursion. I am aware that safe dive practices suggest diving with a buddy and that it is my responsibility to plan my dive and follow the instructions of the dive supervisor/vessel crew.

BY THIS INSTRUMENT, I AGREE TO EXEMPT AND RELEASE ALL THE ABOVE-LISTED ENTITIES AND INDIVIDUALS FROM ALL LIABILITY AND RESPONSIBILITY FOR PERSONAL INJURY, PROPERTY DAMAGE OR WRONGFUL DEATH, HOWEVER CAUSED, INCLUDING THE NEGLIGENCE OF THE RELEASED PARTIES, WHETHER PASSIVE OR ACTIVE. I am of lawful age and legally competent to sign this Agreement, or have obtained the written consent of my parent or guardian, and I sign it of my own free act.

PADI Product No. 10077.`

const DIVER_MEDICAL_BODY = `DIVER MEDICAL — PARTICIPANT QUESTIONNAIRE

Recreational scuba diving and freediving require good physical and mental health. A few medical conditions can be hazardous while diving. This questionnaire is a basis to determine whether you should seek a physician's evaluation before diving.

Before signing, confirm you have completed the PADI Diver Medical Participant Questionnaire (Product No. 10346) honestly. If you answered YES to any question that directs you to a physician — or to questions 3, 5 or 10, or any question on page 2 — you must obtain your physician's approval before participating in diving activities, and provide it to the shop.

Note: if you are pregnant, or attempting to become pregnant, do not dive.

Participant Statement: I have answered all questions on the Diver Medical Participant Questionnaire honestly, and I understand that I accept responsibility for any consequences resulting from any questions I may have answered inaccurately or for my failure to disclose any existing or past health conditions. I affirm it is my responsibility to inform the shop of any change to my health condition.`

const CONTINUING_EDUCATION_BODY = `RELEASE OF LIABILITY / ASSUMPTION OF RISK / NON-AGENCY ACKNOWLEDGMENT — CONTINUING EDUCATION

Safe diving practices: I understand that as a diver I should maintain good mental and physical fitness for diving; be familiar with my dive sites; use complete, well-maintained, reliable equipment and inspect it before each dive; listen to dive briefings and respect the advice of those supervising my diving; adhere to the buddy system; be proficient in dive planning; maintain proper buoyancy; breathe properly and never breath-hold on scuba; use surface support when feasible; and know and obey local dive laws. I recognize these practices are for my own safety and that failure to adhere to them can place me in jeopardy.

Non-agency acknowledgment: I understand and agree that PADI Members, including the instructors and divemasters associated with this program, are licensed to use PADI Trademarks and conduct PADI training, but are not agents, employees or franchisees of PADI Americas, Inc. Member business activities are independent and are neither owned nor operated by PADI. In the event of injury or death during this activity, neither I nor my estate shall seek to hold PADI liable for the actions, inactions or negligence of the Members or their associated staff.

Liability release and assumption of risk: I affirm I am aware that skin and scuba diving have inherent risks which may result in serious injury or death, including decompression sickness, embolism or other hyperbaric/air-expansion injury. This Agreement encompasses all diver training activities and courses in which I choose to participate. I agree that neither my instructors, divemasters, the facility offering the programs, nor PADI Americas, Inc. and its related entities (the "Released Parties") may be held liable for any injury, death or damages to me, my family, estate, heirs or assigns resulting from my participation or the negligence of any party, whether passive or active. In consideration of being allowed to participate, I personally assume all risks, whether foreseen or unforeseen.

I confirm I have completed the attached Diver Medical Form (10346) and that it is my responsibility to inform my instructor of any change to my medical history at any time. I am of lawful age and legally competent to sign, or have acquired the written consent of my parent or guardian, and I sign of my own free act.

PADI Product No. 10038.`

export const WAIVERS: WaiverDef[] = [
  {
    code: 'padi_liability',
    title: 'Boat Travel & Scuba Diving Liability Release',
    cadence: 'annual',
    version: 1,
    appliesTo: 'dives',
    body: PADI_LIABILITY_BODY,
  },
  {
    // Not required by default — the shop opts individual events into it with a
    // per-event 'require' override. Divers may still sign it proactively (it
    // stays in the annual My Waivers panel).
    code: 'diver_medical',
    title: 'Diver Medical Questionnaire',
    cadence: 'annual',
    version: 1,
    appliesTo: 'none',
    body: DIVER_MEDICAL_BODY,
  },
  {
    // PADI continuing-education courses (OW, AOW, Rescue, specialties) require
    // this per enrollment. Discover Scuba / Try Dive (the `dsd` bucket) does
    // not — those entry-level experiences are covered by the dive liability
    // release instead.
    code: 'continuing_education',
    title: 'Continuing Education Liability Release',
    cadence: 'per_event',
    version: 1,
    appliesTo: 'courses',
    courseColors: ['ow', 'aow', 'rescue', 'specialty'],
    body: CONTINUING_EDUCATION_BODY,
  },
]

export function waiverByCode(code: string): WaiverDef | undefined {
  return WAIVERS.find(w => w.code === code)
}

/** How long an `annual` signature stays valid. */
export const ANNUAL_WAIVER_VALID_DAYS = 365
