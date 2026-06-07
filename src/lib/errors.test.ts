import { describe, it, expect } from 'vitest'
import { errorMessage } from './errors'

describe('errorMessage', () => {
  it('returns Error.message for Error instances', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('maps PostgrestError SQLSTATEs to friendly strings (audit L3)', () => {
    // Verbatim PostgREST messages leak schema details (constraint
    // names, column names). Common SQLSTATEs are mapped to safe
    // user-facing strings; unknown codes fall back to the fallback.
    expect(errorMessage({ message: 'duplicate key value violates unique constraint "profiles_email_key"', code: '23505' }))
      .toBe('That value is already in use.')
    expect(errorMessage({ message: 'new row violates row-level security policy', code: '42501' }))
      .toBe('You don\'t have permission to do that.')
    expect(errorMessage({ message: 'detail', code: '22P02' }, 'Couldn\'t parse that.'))
      .toBe('Couldn\'t parse that.')
  })

  it('translates known constraint names to field-specific messages', () => {
    // FK / check violations name the constraint in message/details. We
    // map that to our own copy naming the field — without echoing the raw
    // Postgres text — so the admin knows exactly which entry to fix.
    expect(errorMessage({
      code: '23503',
      message: 'insert or update on table "EO_courses" violates foreign key constraint "EO_courses_prereq_cert_id_fkey"',
      details: 'Key is not present in table "cert_levels".',
    })).toMatch(/required certification/i)

    expect(errorMessage({
      code: '23503',
      message: 'violates foreign key constraint "EO_courses_price_fkey"',
    })).toMatch(/price tier/i)

    expect(errorMessage({
      code: '23503',
      message: 'violates foreign key constraint "EO_dives_cancel_policy_fkey"',
    })).toMatch(/cancellation policy/i)

    expect(errorMessage({
      code: '23514',
      message: 'new row violates check constraint "eo_courses_course_days_len"',
    })).toMatch(/at most 4 days/i)
  })

  it('falls back to the generic SQLSTATE string when no constraint matches', () => {
    expect(errorMessage({ code: '23503', message: 'violates foreign key constraint "some_other_fkey"' }))
      .toBe('A referenced item could not be found.')
  })

  it('extracts .error string from auth-style failures', () => {
    expect(errorMessage({ error: 'Invalid login credentials' })).toBe('Invalid login credentials')
  })

  it('returns the string itself when given a string', () => {
    expect(errorMessage('not allowed')).toBe('not allowed')
  })

  it('returns the fallback for objects with no message — never "[object Object]"', () => {
    expect(errorMessage({ foo: 'bar' })).toBe('Something went wrong.')
    expect(errorMessage({ foo: 'bar' }, 'Custom fallback')).toBe('Custom fallback')
  })

  it('returns the fallback for null / undefined / empty inputs', () => {
    expect(errorMessage(null)).toBe('Something went wrong.')
    expect(errorMessage(undefined)).toBe('Something went wrong.')
    expect(errorMessage('')).toBe('Something went wrong.')
    expect(errorMessage('   ')).toBe('Something went wrong.')
  })
})
