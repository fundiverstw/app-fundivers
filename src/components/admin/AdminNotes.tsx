import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { NOTE_TAGS, type AdminNote, type NoteTag, type Profile } from '../../types/database'

const TAG_STYLES: Record<NoteTag, string> = {
  urgent:    'bg-rose-700 text-rose-100',
  payment:   'bg-amber-700 text-amber-100',
  gear:      'bg-sky-700 text-sky-100',
  logistics: 'bg-violet-700 text-violet-100',
  cert:      'bg-emerald-700 text-emerald-100',
  medical:   'bg-fuchsia-700 text-fuchsia-100',
  note:      'bg-slate-700 text-slate-200',
  general:   'bg-slate-700 text-slate-200',
}

type NoteWithAuthors = AdminNote & {
  author: Pick<Profile, 'id' | 'display_name' | 'full_name'> | null
  resolver: Pick<Profile, 'id' | 'display_name' | 'full_name'> | null
}

export type NoteTarget =
  | { kind: 'dive'; id: string }
  | { kind: 'course'; id: string }
  | { kind: 'booking'; id: string }

interface Props {
  target: NoteTarget
  /** Optional: restrict both reads and new-note inserts to this tag. */
  tagFilter?: NoteTag
  /** Optional: override the section heading. */
  title?: string
}

function columnFor(target: NoteTarget): 'eo_dive_id' | 'eo_course_id' | 'booking_id' {
  return target.kind === 'dive' ? 'eo_dive_id'
       : target.kind === 'course' ? 'eo_course_id'
       : 'booking_id'
}

function fkPayload(target: NoteTarget) {
  return {
    eo_dive_id:   target.kind === 'dive'   ? target.id : null,
    eo_course_id: target.kind === 'course' ? target.id : null,
    booking_id:   target.kind === 'booking' ? target.id : null,
  }
}

export function AdminNotes({ target, tagFilter, title = 'Notes' }: Props) {
  const { user } = useAuth()
  const [notes, setNotes] = useState<NoteWithAuthors[]>([])
  const [showResolved, setShowResolved] = useState(false)
  const [tag, setTag] = useState<NoteTag>(tagFilter ?? 'note')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  async function refetch() {
    let q = supabase
      .from('admin_notes')
      .select('*')
      .eq(columnFor(target), target.id)
      .order('created_at', { ascending: false })
    if (tagFilter) q = q.eq('tag', tagFilter)
    const { data: rows } = await q

    const ids = [
      ...(rows ?? []).map(r => r.created_by),
      ...(rows ?? []).map(r => r.resolved_by).filter((x): x is string => !!x),
    ]
    let profMap = new Map<string, Pick<Profile, 'id' | 'display_name' | 'full_name'>>()
    if (ids.length) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, display_name, full_name')
        .in('id', [...new Set(ids)])
      profMap = new Map((profs ?? []).map(p => [p.id, p]))
    }

    setNotes((rows ?? []).map(r => ({
      ...r,
      author: profMap.get(r.created_by) ?? null,
      resolver: r.resolved_by ? (profMap.get(r.resolved_by) ?? null) : null,
    })))
  }

  useEffect(() => { refetch() }, [target.kind, target.id, tagFilter])

  async function addNote() {
    if (!user || !content.trim()) return
    setSaving(true)
    await supabase.from('admin_notes').insert({
      created_by: user.id,
      tag: tagFilter ?? tag,
      content: content.trim(),
      ...fkPayload(target),
    })
    setContent('')
    if (!tagFilter) setTag('note')
    await refetch()
    setSaving(false)
  }

  async function resolve(noteId: string) {
    if (!user) return
    await supabase
      .from('admin_notes')
      .update({ resolved: true, resolved_by: user.id, resolved_at: new Date().toISOString() })
      .eq('id', noteId)
    await refetch()
  }

  async function unresolve(noteId: string) {
    await supabase
      .from('admin_notes')
      .update({ resolved: false, resolved_by: null, resolved_at: null })
      .eq('id', noteId)
    await refetch()
  }

  const open = notes.filter(m => !m.resolved)
  const resolved = notes.filter(m => m.resolved)

  return (
    <section className="bg-slate-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">{title}</h2>
        {resolved.length > 0 && (
          <button
            onClick={() => setShowResolved(v => !v)}
            className="text-xs text-slate-400 hover:text-slate-100"
          >
            {showResolved ? 'Hide resolved' : `Show resolved (${resolved.length})`}
          </button>
        )}
      </div>

      <div className="space-y-2">
        {open.length === 0 && (
          <p className="text-xs text-slate-500">No open notes.</p>
        )}
        {open.map(m => (
          <NoteCard key={m.id} note={m} onResolve={() => resolve(m.id)} />
        ))}
        {showResolved && resolved.map(m => (
          <NoteCard key={m.id} note={m} onUnresolve={() => unresolve(m.id)} />
        ))}
      </div>

      <div className="pt-2 border-t border-slate-700 space-y-2">
        <div className="flex gap-2">
          {!tagFilter && (
            <select
              value={tag}
              onChange={e => setTag(e.target.value as NoteTag)}
              className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-100"
            >
              {NOTE_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <input
            type="text"
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="New note…"
            className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
            onKeyDown={e => { if (e.key === 'Enter') addNote() }}
          />
          <button
            onClick={addNote}
            disabled={saving || !content.trim()}
            className="bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white text-xs px-3 rounded-lg"
          >
            Add
          </button>
        </div>
      </div>
    </section>
  )
}

function NoteCard({ note, onResolve, onUnresolve }: {
  note: NoteWithAuthors
  onResolve?: () => void
  onUnresolve?: () => void
}) {
  const author = note.author?.display_name ?? note.author?.full_name ?? 'unknown'
  return (
    <div className={`bg-slate-900/50 rounded-lg p-3 text-sm ${note.resolved ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2">
        <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded-full shrink-0 ${TAG_STYLES[note.tag]}`}>
          {note.tag}
        </span>
        <p className={`flex-1 text-slate-100 ${note.resolved ? 'line-through' : ''}`}>{note.content}</p>
        {onResolve && (
          <button onClick={onResolve} className="text-xs text-slate-400 hover:text-emerald-400 shrink-0">✓ resolve</button>
        )}
        {onUnresolve && (
          <button onClick={onUnresolve} className="text-xs text-slate-400 hover:text-sky-400 shrink-0">↺ reopen</button>
        )}
      </div>
      <p className="text-xs text-slate-500 mt-1">
        {author} · {format(new Date(note.created_at), 'MMM d · HH:mm')}
        {note.resolved && note.resolved_at && (
          <> · resolved by {note.resolver?.display_name ?? note.resolver?.full_name ?? 'unknown'} {format(new Date(note.resolved_at), 'MMM d')}</>
        )}
      </p>
    </div>
  )
}
