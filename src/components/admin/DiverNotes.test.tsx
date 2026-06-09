import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DiverNotes } from './DiverNotes'
import { mockQueryBuilder } from '../../../tests/test-utils'

const { from, useAuthMock } = vi.hoisted(() => ({
  from: vi.fn(),
  useAuthMock: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))

beforeEach(() => {
  from.mockReset()
  useAuthMock.mockReset()
  useAuthMock.mockReturnValue({
    user: { id: 'staff-1' },
    profile: { id: 'staff-1', role: 'staff' },
  })
})

function setupReads(notes: unknown[], authors: unknown[]) {
  from.mockImplementation((table: string) => {
    if (table === 'diver_notes') return mockQueryBuilder({ data: notes })
    if (table === 'profiles')    return mockQueryBuilder({ data: authors })
    return mockQueryBuilder({ data: [] })
  })
}

describe('DiverNotes', () => {
  it('renders existing notes with author + created date', async () => {
    setupReads(
      [{
        id: 'n1', profile_id: 'diver-1', created_by: 'staff-1',
        content: 'Severe shellfish allergy', created_at: '2026-05-01T10:00:00Z',
        edited_by: null, edited_at: null,
      }],
      [{ id: 'staff-1', nickname: 'Ada', name: 'Ada Lovelace' }],
    )

    render(<DiverNotes profileId="diver-1" />)
    await screen.findByText('Severe shellfish allergy')
    expect(screen.getByText(/Ada/)).toBeInTheDocument()
  })

  it('shows "edited" suffix when the note has been edited', async () => {
    setupReads(
      [{
        id: 'n1', profile_id: 'diver-1', created_by: 'staff-1',
        content: 'updated', created_at: '2026-05-01T10:00:00Z',
        edited_by: 'admin-1', edited_at: '2026-05-02T11:00:00Z',
      }],
      [
        { id: 'staff-1', nickname: 'Ada',   name: 'Ada Lovelace' },
        { id: 'admin-1', nickname: 'Admin', name: 'Admin User' },
      ],
    )

    render(<DiverNotes profileId="diver-1" />)
    await screen.findByText('updated')
    expect(screen.getByText(/edited by Admin/)).toBeInTheDocument()
  })

  it('inserts a new note via the textarea + Add button', async () => {
    const insert = vi.fn().mockReturnValue(Promise.resolve({ data: null, error: null }))
    from.mockImplementation((table: string) => {
      if (table === 'diver_notes') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.insert = insert
        return b
      }
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    render(<DiverNotes profileId="diver-1" />)

    await user.type(screen.getByLabelText(/new diver note/i), 'allergic to shellfish')
    await user.click(screen.getByRole('button', { name: /add note/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(insert.mock.calls[0][0]).toMatchObject({
      profile_id: 'diver-1',
      created_by: 'staff-1',
      content:    'allergic to shellfish',
    })
  })

  it('shows Edit/Delete on the note author\'s own notes', async () => {
    setupReads(
      [{
        id: 'n1', profile_id: 'diver-1', created_by: 'staff-1',
        content: 'mine', created_at: '2026-05-01T10:00:00Z',
        edited_by: null, edited_at: null,
      }],
      [{ id: 'staff-1', nickname: 'Ada', name: 'Ada Lovelace' }],
    )

    render(<DiverNotes profileId="diver-1" />)
    await screen.findByText('mine')
    expect(screen.getByRole('button', { name: /edit note from ada/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete note from ada/i })).toBeInTheDocument()
  })

  it("hides Edit/Delete on another staff member's note when viewer is staff", async () => {
    setupReads(
      [{
        id: 'n1', profile_id: 'diver-1', created_by: 'staff-2',
        content: 'theirs', created_at: '2026-05-01T10:00:00Z',
        edited_by: null, edited_at: null,
      }],
      [{ id: 'staff-2', nickname: 'Grace', name: 'Grace Hopper' }],
    )

    render(<DiverNotes profileId="diver-1" />)
    await screen.findByText('theirs')
    expect(screen.queryByRole('button', { name: /edit note/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete note/i })).not.toBeInTheDocument()
  })

  it("shows Edit/Delete on any note when viewer is admin", async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'admin-1' },
      profile: { id: 'admin-1', role: 'admin' },
    })
    setupReads(
      [{
        id: 'n1', profile_id: 'diver-1', created_by: 'staff-2',
        content: 'someone else wrote this', created_at: '2026-05-01T10:00:00Z',
        edited_by: null, edited_at: null,
      }],
      [{ id: 'staff-2', nickname: 'Grace', name: 'Grace Hopper' }],
    )

    render(<DiverNotes profileId="diver-1" />)
    await screen.findByText('someone else wrote this')
    expect(screen.getByRole('button', { name: /edit note from grace/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete note from grace/i })).toBeInTheDocument()
  })

  it('Edit → Save updates the note with edit metadata', async () => {
    const update = vi.fn().mockReturnValue({
      eq: () => Promise.resolve({ data: null, error: null }),
    })
    let firstCall = true
    from.mockImplementation((table: string) => {
      if (table === 'diver_notes') {
        const b = mockQueryBuilder({
          data: firstCall ? [{
            id: 'n1', profile_id: 'diver-1', created_by: 'staff-1',
            content: 'first', created_at: '2026-05-01T10:00:00Z',
            edited_by: null, edited_at: null,
          }] : [],
        }) as Record<string, unknown>
        b.update = update
        firstCall = false
        return b
      }
      if (table === 'profiles') return mockQueryBuilder({
        data: [{ id: 'staff-1', nickname: 'Ada', name: 'Ada Lovelace' }],
      })
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    render(<DiverNotes profileId="diver-1" />)
    await screen.findByText('first')

    await user.click(screen.getByRole('button', { name: /edit note from ada/i }))
    const editBox = screen.getByLabelText(/edit note/i)
    await user.clear(editBox)
    await user.type(editBox, 'second')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(update).toHaveBeenCalled())
    const payload = update.mock.calls[0][0] as Record<string, unknown>
    expect(payload.content).toBe('second')
    expect(payload.edited_by).toBe('staff-1')
    expect(typeof payload.edited_at).toBe('string')
  })

  it('Delete fires a delete against the note id', async () => {
    const del = vi.fn().mockReturnValue({
      eq: () => Promise.resolve({ data: null, error: null }),
    })
    from.mockImplementation((table: string) => {
      if (table === 'diver_notes') {
        const b = mockQueryBuilder({
          data: [{
            id: 'n1', profile_id: 'diver-1', created_by: 'staff-1',
            content: 'kill me', created_at: '2026-05-01T10:00:00Z',
            edited_by: null, edited_at: null,
          }],
        }) as Record<string, unknown>
        b.delete = del
        return b
      }
      if (table === 'profiles') return mockQueryBuilder({
        data: [{ id: 'staff-1', nickname: 'Ada', name: 'Ada Lovelace' }],
      })
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    render(<DiverNotes profileId="diver-1" />)
    await screen.findByText('kill me')

    await user.click(screen.getByRole('button', { name: /delete note from ada/i }))
    await waitFor(() => expect(del).toHaveBeenCalled())
  })
})
