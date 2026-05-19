import { describe, it, expect } from 'vitest'
import { adminClient } from './helpers'

// Pins the generated `*_ts` columns on EO_dives / EO_courses: every date
// column has a sibling `timestamptz` anchored to Asia/Taipei (+08:00),
// which the wix_sync triggers POST to Velo so Wix DateTime fields get
// a real ISO instant instead of a bare YYYY-MM-DD string.

const admin = adminClient()

describe('EO event Taipei-anchored timestamp columns', () => {
  it('EO_dives.start_ts / end_ts combine the date + time at +08:00', async () => {
    const id = crypto.randomUUID()
    try {
      const { error } = await admin.from('EO_dives' as never).insert({
        _id: id,
        admin_title: 'TZ Test Dive',
        notes: '',
        start_date: '2027-05-15',
        end_date:   '2027-05-15',
        time:       '09:00:00',
      } as never)
      expect(error).toBeNull()

      const { data, error: rErr } = await admin
        .from('EO_dives' as never)
        .select('start_ts, end_ts, cancel_date_ts, deposit_deadline_ts, full_payment_deadline_ts')
        .eq('_id', id)
        .single()
      expect(rErr).toBeNull()
      const row = data as Record<string, string | null>
      // 09:00 Taipei is 01:00 UTC.
      expect(new Date(row.start_ts!).toISOString()).toBe('2027-05-15T01:00:00.000Z')
      expect(new Date(row.end_ts!).toISOString()).toBe('2027-05-15T01:00:00.000Z')
      // Null source date → null ts.
      expect(row.cancel_date_ts).toBeNull()
      expect(row.deposit_deadline_ts).toBeNull()
      expect(row.full_payment_deadline_ts).toBeNull()
    } finally {
      await admin.from('EO_dives' as never).delete().eq('_id', id)
    }
  })

  it('EO_dives date-only deadlines collapse to midnight Taipei', async () => {
    const id = crypto.randomUUID()
    try {
      const { error } = await admin.from('EO_dives' as never).insert({
        _id: id,
        admin_title: 'TZ Test Dive 2',
        notes: '',
        start_date:            '2027-06-01',
        end_date:              '2027-06-01',
        time:                  '00:00:00',
        cancel_date:           '2027-05-28',
        deposit_deadline:      '2027-05-25',
        full_payment_deadline: '2027-05-31',
      } as never)
      expect(error).toBeNull()

      const { data } = await admin
        .from('EO_dives' as never)
        .select('cancel_date_ts, deposit_deadline_ts, full_payment_deadline_ts')
        .eq('_id', id)
        .single()
      const row = data as Record<string, string>
      // Midnight Taipei → 16:00 UTC the previous day.
      expect(new Date(row.cancel_date_ts).toISOString()).toBe('2027-05-27T16:00:00.000Z')
      expect(new Date(row.deposit_deadline_ts).toISOString()).toBe('2027-05-24T16:00:00.000Z')
      expect(new Date(row.full_payment_deadline_ts).toISOString()).toBe('2027-05-30T16:00:00.000Z')
    } finally {
      await admin.from('EO_dives' as never).delete().eq('_id', id)
    }
  })

  it('EO_courses.start_ts / end_ts / special_ts compute correctly', async () => {
    const id = crypto.randomUUID()
    try {
      const { error } = await admin.from('EO_courses' as never).insert({
        _id: id,
        display_title: 'TZ Test Course',
        start_date:   '2027-07-10',
        end_date:     '2027-07-12',
        start_time:   '14:30:00',
        special_date: '2027-07-11',
      } as never)
      expect(error).toBeNull()

      const { data } = await admin
        .from('EO_courses' as never)
        .select('start_ts, end_ts, special_ts')
        .eq('_id', id)
        .single()
      const row = data as Record<string, string>
      // 14:30 Taipei = 06:30 UTC.
      expect(new Date(row.start_ts).toISOString()).toBe('2027-07-10T06:30:00.000Z')
      expect(new Date(row.end_ts).toISOString()).toBe('2027-07-12T06:30:00.000Z')
      // special_date has no paired time → midnight Taipei = 16:00 UTC prev day.
      expect(new Date(row.special_ts).toISOString()).toBe('2027-07-10T16:00:00.000Z')
    } finally {
      await admin.from('EO_courses' as never).delete().eq('_id', id)
    }
  })
})
