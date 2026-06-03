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
