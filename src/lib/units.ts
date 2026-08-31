// Metric / imperial display units for the two body measurements the shop
// collects: height and weight.
//
// The database is metric and stays metric — profiles.height_cm and
// profiles.weight_kg are numeric columns, gear-sizing.ts matches wetsuit and
// BCD ranges in cm/kg, and the admin screens print cm/kg. Nothing here changes
// what is stored. This module is a display layer: it converts on the way into
// an input and back out of it, so a diver who thinks in feet and pounds never
// has to open a converter in another tab to fill in their profile.
//
// The preference is per-browser (localStorage), not a profile column. It
// describes how one person likes to read numbers on one device, it has no
// meaning to staff, and making it a column would mean a migration plus a
// decision about which unit an admin sees when looking at someone else's
// profile. Device-local sidesteps all of that. A browser with storage blocked
// simply gets the config default every time, which is a working app.

import { siteConfig } from '../config/site'

export type UnitSystem = 'metric' | 'imperial'

export const UNIT_SYSTEMS: readonly UnitSystem[] = ['metric', 'imperial']

const STORAGE_KEY = 'fundive.units'

const CM_PER_INCH = 2.54
const INCHES_PER_FOOT = 12
const KG_PER_LB = 0.45359237

// Which way the field opens before the diver has expressed a preference. It is
// a config field rather than something derived from `language`, because the two
// are genuinely unrelated: this shop renders in English from Taiwan, where
// every diver is metric, and inferring imperial from 'en' would have handed
// them feet and pounds.
function configDefault(): UnitSystem {
  return siteConfig.locale.units
}

/** The stored preference, or the config default when nothing is stored. */
export function readUnitSystem(): UnitSystem {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'metric' || raw === 'imperial') return raw
  } catch { /* storage blocked (private mode, embedded webview) — use the default */ }
  return configDefault()
}

export function writeUnitSystem(system: UnitSystem): void {
  try {
    localStorage.setItem(STORAGE_KEY, system)
  } catch { /* nothing to do — the choice just won't survive a reload */ }
}

// Rounding. Every conversion below lands on a value a person would actually
// type, not a float tail: whole inches and whole pounds going out to an
// imperial field, one decimal place going back to the metric column (which is
// what the profile form's step="0.1" already allowed).
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export interface FeetInches {
  feet:   number
  inches: number
}

/**
 * Centimeters to whole feet + whole inches. Inches carry the rounding, so
 * 182.9cm reads as 6'0" rather than 5'11.96".
 */
export function cmToFeetInches(cm: number): FeetInches {
  const totalInches = Math.round(cm / CM_PER_INCH)
  return {
    feet:   Math.floor(totalInches / INCHES_PER_FOOT),
    inches: totalInches % INCHES_PER_FOOT,
  }
}

/** Feet + inches back to centimeters, one decimal place. */
export function feetInchesToCm({ feet, inches }: FeetInches): number {
  return round1((feet * INCHES_PER_FOOT + inches) * CM_PER_INCH)
}

/** Kilograms to whole pounds. */
export function kgToLb(kg: number): number {
  return Math.round(kg / KG_PER_LB)
}

/** Pounds back to kilograms, one decimal place. */
export function lbToKg(lb: number): number {
  return round1(lb * KG_PER_LB)
}

/**
 * Height for display in `system`. Metric returns the stored number untouched;
 * imperial returns feet + inches. Null in, null out — an unset measurement
 * must stay unset rather than becoming a confident 0'0".
 */
export function displayHeight(cm: number | null, system: UnitSystem): FeetInches | number | null {
  if (cm == null) return null
  return system === 'imperial' ? cmToFeetInches(cm) : cm
}

/** Weight for display in `system`. Null in, null out. */
export function displayWeight(kg: number | null, system: UnitSystem): number | null {
  if (kg == null) return null
  return system === 'imperial' ? kgToLb(kg) : kg
}

// Round-trip stability. Converting 180cm to 5'11" and straight back gives
// 180.3cm — the inch grid is coarser than the centimeter grid, so a diver who
// merely *looks* at the imperial view and switches away would watch their
// saved height drift. displayHeight/feetInchesToCm are therefore only applied
// to values the diver actually edited; these two predicates let a caller ask
// whether an edit changed anything real before writing.

/** True when `cm` and the feet/inches shown for it describe the same height. */
export function sameHeight(cm: number | null, fi: FeetInches | null): boolean {
  if (cm == null || fi == null) return cm == null && fi == null
  const shown = cmToFeetInches(cm)
  return shown.feet === fi.feet && shown.inches === fi.inches
}

/** True when `kg` and the pounds shown for it describe the same weight. */
export function sameWeight(kg: number | null, lb: number | null): boolean {
  if (kg == null || lb == null) return kg == null && lb == null
  return kgToLb(kg) === lb
}

/**
 * Both registration forms hold measurements as form strings — that is what
 * their localStorage draft persists — so this is the one place that turns a
 * blank or unparseable one into the null the measurement fields expect.
 */
export function numOrNullStr(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}
