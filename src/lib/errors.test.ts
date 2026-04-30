import { describe, it, expect } from 'vitest'
import { errorMessage } from './errors'

describe('errorMessage', () => {
  it('returns Error.message for Error instances', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })

  it('extracts .message from PostgrestError-shaped objects', () => {
    const pg = { message: 'duplicate key', code: '23505', details: null, hint: null }
    expect(errorMessage(pg)).toBe('duplicate key')
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
