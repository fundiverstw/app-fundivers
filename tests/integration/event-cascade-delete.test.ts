import { describe, it, expect } from 'vitest'
import { adminClient, createTestUser, createTestDive, deleteTestUser } from './helpers'

// Pins the cascade-delete contract on EO_dives. Every FK pointing at an
// EO event already uses ON DELETE CASCADE; this test ensures that contract
// stays intact so the AdminEventDetailPage delete flow keeps working
// without orphan rows. Booking → payments / amendments / waitlist_offers
// are transitive cascades and exercised through the booking that gets
// removed when the parent dive is deleted.

const admin = adminClient()

describe('deleting an EO_dive cascades to its dependents', () => {
  it('removes bookings, payments, amendments, and memos linked to the deleted dive', async () => {
    const diver = await createTestUser(admin)
    const diveId = await createTestDive(admin)
    try {
      const { data: booking, error: bErr } = await admin
        .from('bookings')
        .insert({
          user_id: diver.id,
          status: 'pending',
          eo_dive_id: diveId,
          eo_course_id: null,
          details: {},
        } as never)
        .select().single()
      expect(bErr).toBeNull()
      const bookingId = (booking as { id: string }).id

      const { error: pErr } = await admin.from('payments').insert({
        booking_id: bookingId,
        user_id: diver.id,
        amount: 1000,
        currency: 'NTD',
        note: 'deposit',
      } as never)
      expect(pErr).toBeNull()

      const { error: aErr } = await admin.from('booking_amendments').insert({
        booking_id: bookingId,
        amount: -200,
        note: 'discount',
        created_by: diver.id,
      } as never)
      expect(aErr).toBeNull()

      const { error: mErr } = await admin.from('admin_notes' as never).insert({
        eo_dive_id: diveId,
        eo_course_id: null,
        booking_id: null,
        tag: 'note',
        content: 'briefing note',
        created_by: diver.id,
      } as never)
      expect(mErr).toBeNull()

      // Drop the parent — cascade should sweep everything tied to it.
      const { error: dErr } = await admin.from('EO_dives' as never).delete().eq('_id', diveId)
      expect(dErr).toBeNull()

      const { data: bookingsLeft } = await admin
        .from('bookings').select('id').eq('id', bookingId)
      expect(bookingsLeft ?? []).toEqual([])

      const { data: paymentsLeft } = await admin
        .from('payments').select('id').eq('booking_id', bookingId)
      expect(paymentsLeft ?? []).toEqual([])

      const { data: amendmentsLeft } = await admin
        .from('booking_amendments').select('id').eq('booking_id', bookingId)
      expect(amendmentsLeft ?? []).toEqual([])

      const { data: notesLeft } = await admin
        .from('admin_notes' as never).select('id').eq('eo_dive_id', diveId)
      expect(notesLeft ?? []).toEqual([])
    } finally {
      // Dive is already gone if the test passed; this is just belt-and-braces
      // for the failure path.
      await admin.from('EO_dives' as never).delete().eq('_id', diveId)
      await deleteTestUser(admin, diver.id)
    }
  })
})
