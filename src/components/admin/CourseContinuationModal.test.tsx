import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CourseContinuationModal } from './CourseContinuationModal'
import type { AppEvent } from '../../types/database'
import { t } from '../../i18n'

const { from, fetchContinuableCourses, createCourseContinuation } = vi.hoisted(() => ({
  from: vi.fn(),
  fetchContinuableCourses: vi.fn(),
  createCourseContinuation: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))
vi.mock('../../lib/course-continuation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/course-continuation')>()),
  fetchContinuableCourses: (...a: unknown[]) => fetchContinuableCourses(...a),
  createCourseContinuation: (...a: unknown[]) => createCourseContinuation(...a),
}))

const cn = t.admin.continuation

// The course being continued *onto*: two days in July.
const targetEvent = { id: 'course-july', title: 'OW July', type: 'course' } as AppEvent
const targetDays = ['2026-07-04', '2026-07-05']

const sourceCourse = {
  booking: { id: 'b-june', user_id: 'u1', event_id: 'course-june', attend_days: null },
  eventId: 'course-june',
  title: 'OW June',
  courseDays: ['2026-06-06', '2026-06-07'],
}

function stub(result: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order']) b[m] = () => b
  b.maybeSingle = () => Promise.resolve(result)
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
  return b
}

beforeEach(() => {
  from.mockReset(); fetchContinuableCourses.mockReset(); createCourseContinuation.mockReset()
  from.mockImplementation((table: string) =>
    stub(table === 'events'
      ? { data: { course_days: targetDays }, error: null }
      : { data: [{ id: 'u1', name: 'Ada Chen', nickname: null, contact_id: 'ada-line' }], error: null }))
  fetchContinuableCourses.mockResolvedValue([sourceCourse])
  createCourseContinuation.mockResolvedValue('new-booking')
})

function renderModal(onAdded = vi.fn()) {
  render(<CourseContinuationModal event={targetEvent} onClose={vi.fn()} onAdded={onAdded} />)
  return onAdded
}

async function pickDiverAndCourse(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText('Ada Chen'))
  await user.click(await screen.findByText('OW June'))
}

describe('CourseContinuationModal', () => {
  it('walks diver → their earlier course → the days they attend here', async () => {
    const user = userEvent.setup()
    renderModal()
    await pickDiverAndCourse(user)

    // Both day pickers are offered: this course's days, and the original's.
    expect(screen.getByText(cn.daysHere)).toBeInTheDocument()
    expect(screen.getByText(cn.daysThere)).toBeInTheDocument()
    expect(screen.getByText('Jul 4')).toBeInTheDocument()
    expect(screen.getByText('Jun 6')).toBeInTheDocument()
    // The admin is told, before submitting, that this costs nothing.
    expect(screen.getByText(cn.noCharge)).toBeInTheDocument()
  })

  it('sends only the days left ticked', async () => {
    const user = userEvent.setup()
    const onAdded = renderModal()
    await pickDiverAndCourse(user)

    // They're only here for the second day of the July course.
    await user.click(screen.getByLabelText('Jul 4'))
    await user.click(screen.getByRole('button', { name: cn.submit }))

    await waitFor(() => expect(createCourseContinuation).toHaveBeenCalled())
    expect(createCourseContinuation.mock.calls[0][0]).toMatchObject({
      sourceBookingId: 'b-june',
      eventId: 'course-july',
      days: ['2026-07-05'],
    })
    expect(onAdded).toHaveBeenCalled()
  })

  // An untouched original keeps its NULL attend_days — sending back the full
  // list would write "attends exactly these days" onto a booking nobody trimmed.
  it('sends no trim when the original course is left untouched', async () => {
    const user = userEvent.setup()
    renderModal()
    await pickDiverAndCourse(user)
    await user.click(screen.getByRole('button', { name: cn.submit }))

    await waitFor(() => expect(createCourseContinuation).toHaveBeenCalled())
    expect(createCourseContinuation.mock.calls[0][0]).not.toHaveProperty('sourceDays')
  })

  it('sends the trim when the admin unticks a missed day on the original', async () => {
    const user = userEvent.setup()
    renderModal()
    await pickDiverAndCourse(user)

    await user.click(screen.getByLabelText('Jun 7'))
    await user.click(screen.getByRole('button', { name: cn.submit }))

    await waitFor(() => expect(createCourseContinuation).toHaveBeenCalled())
    expect(createCourseContinuation.mock.calls[0][0]).toMatchObject({ sourceDays: ['2026-06-06'] })
  })

  it('refuses to submit with no day ticked', async () => {
    const user = userEvent.setup()
    renderModal()
    await pickDiverAndCourse(user)

    await user.click(screen.getByLabelText('Jul 4'))
    await user.click(screen.getByLabelText('Jul 5'))
    await user.click(screen.getByRole('button', { name: cn.submit }))

    expect(await screen.findByText(cn.noDaysPicked)).toBeInTheDocument()
    expect(createCourseContinuation).not.toHaveBeenCalled()
  })

  it('shows the database rule when the pairing is refused', async () => {
    createCourseContinuation.mockRejectedValue(new Error('this diver is already booked on that course'))
    const user = userEvent.setup()
    renderModal()
    await pickDiverAndCourse(user)
    await user.click(screen.getByRole('button', { name: cn.submit }))

    expect(await screen.findByText(/already booked on that course/i)).toBeInTheDocument()
  })

  it('says so when the diver has no course to continue', async () => {
    fetchContinuableCourses.mockResolvedValue([])
    const user = userEvent.setup()
    renderModal()
    await user.click(await screen.findByText('Ada Chen'))

    expect(await screen.findByText(/no other course booking to continue/i)).toBeInTheDocument()
  })
})
