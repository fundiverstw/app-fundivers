import { useCallback, useEffect, useState } from 'react'
import { personName } from '../../lib/names'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { NOTE_TAGS, type AdminNote, type NoteTag, type Profile } from '../../types/database'
import { t } from '../../i18n'

const nt = t.admin.notes

const TAG_STYLES: Record<NoteTag, string> = {
  urgent:    'bg-rose-700 text-rose-100',
  payment:   'bg-amber-700 text-amber-100',
  gear:      'bg-surface-700 text-surface-100',
  logistics: 'bg-violet-700 text-violet-100',
  cert:      'bg-emerald-700 text-emerald-100',
  medical:   'bg-fuchsia-700 text-fuchsia-100',
  note:      'bg-surface-100 text-brand-900',
  general:   'bg-surface-100 text-brand-900',
}

type NoteWithAuthors = AdminNote & {
  author: Pick<Profile, 'id' | 'nickname' | 'name'> | null
  resolver: Pick<Profile, 'id' | 'nickname' | 'name'> | null
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
  /** Dense inline variant for embedding inside another card (e.g. the gear
   *  card): no outer card chrome, one-line empty state, add form behind a
   *  toggle so the common "no flags" case takes a single row. */
  compact?: boolean
}

function columnFor(target: NoteTarget): 'event_id' | 'booking_id' {
  return target.kind === 'booking' ? 'booking_id' : 'event_id'
}

function fkPayload(target: NoteTarget) {
  return {
    event_id:   target.kind === 'booking' ? null : target.id,
    booking_id: target.kind === 'booking' ? target.id : null,
  }
}

export function AdminNotes({ target, tagFilter, title = nt.title, compact = false }: Props) {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [notes, setNotes] = useState<NoteWithAuthors[]>([])
  const [showResolved, setShowResolved] = useState(false)
  const [tag, setTag] = useState<NoteTag>(tagFilter ?? 'note')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  // Compact mode keeps the add form hidden until the user opts in.
  const [adding, setAdding] = useState(false)

  // useCallback so the refetch identity is stable across renders that
  // don't change target/tagFilter, satisfying react-hooks/exhaustive-deps
  // and avoiding the set-state-in-effect warning that fires when an
  // anonymous arrow inside useEffect transitively calls setState.
  const refetch = useCallback(async () => {
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
    let profMap = new Map<string, Pick<Profile, 'id' | 'nickname' | 'name'>>()
    if (ids.length) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, nickname, name')
        .in('id', [...new Set(ids)])
      profMap = new Map((profs ?? []).map(p => [p.id, p]))
    }

    setNotes((rows ?? []).map(r => ({
      ...r,
      author: profMap.get(r.created_by) ?? null,
      resolver: r.resolved_by ? (profMap.get(r.resolved_by) ?? null) : null,
    })))
  }, [target, tagFilter])

  // Loading data on mount + dep change is the canonical "subscribe to
  // external state" pattern; the rule flags it because refetch calls
  // setNotes transitively. Killing it cleanly would mean dragging in
  // TanStack Query / SWR for one call site — not worth it.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refetch() }, [refetch])

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
    if (compact) setAdding(false)
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
  const showForm = !compact || adding

  const Tag = compact ? 'div' : 'section'
  const wrapperClass = compact
    ? 'pt-2 mt-1 border-t border-surface-200 space-y-2'
    : 'bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3'

  return (
    <Tag className={wrapperClass}>
      <div className="flex items-center justify-between gap-2">
        <h2 className={compact
          ? 'text-xs font-semibold text-brand-900'
          : 'text-sm font-semibold text-red-600 uppercase tracking-wider'}>
          {title}
          {compact && open.length === 0 && (
            <span className="font-normal text-brand-950/60"> · none</span>
          )}
        </h2>
        <div className="flex items-center gap-3">
          {resolved.length > 0 && (
            <button
              onClick={() => setShowResolved(v => !v)}
              className="text-xs text-brand-900 font-medium hover:text-brand-900"
            >
              {showResolved ? nt.hideResolved : nt.showResolved(resolved.length)}
            </button>
          )}
          {compact && (
            <button
              onClick={() => setAdding(a => !a)}
              className="text-xs text-brand-900 font-semibold hover:text-brand-950 shrink-0"
            >
              {adding ? nt.cancel : nt.add}
            </button>
          )}
        </div>
      </div>

      {(open.length > 0 || (showResolved && resolved.length > 0)) && (
        <div className="space-y-2">
          {open.map(m => (
            <NoteCard key={m.id} note={m} onResolve={isAdmin ? () => resolve(m.id) : undefined} />
          ))}
          {showResolved && resolved.map(m => (
            <NoteCard key={m.id} note={m} onUnresolve={isAdmin ? () => unresolve(m.id) : undefined} />
          ))}
        </div>
      )}
      {!compact && open.length === 0 && (
        <p className="text-xs text-brand-950 font-medium">{nt.noOpenNotes}</p>
      )}

      {showForm && (
        <div className={compact ? 'space-y-2' : 'pt-2 border-t border-surface-200 space-y-2'}>
          <div className="flex flex-col sm:flex-row gap-2">
            {!tagFilter && (
              <select
                value={tag}
                onChange={e => setTag(e.target.value as NoteTag)}
                className="sm:shrink-0 bg-white border border-surface-300 rounded-lg px-2 py-1 text-xs text-brand-900"
              >
                {NOTE_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            <input
              type="text"
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={nt.newNotePlaceholder}
              className="sm:flex-1 min-w-0 bg-white border border-surface-300 rounded-lg px-3 py-1.5 text-sm text-brand-900 focus:outline-none focus:border-brand-900"
              onKeyDown={e => { if (e.key === 'Enter') addNote() }}
            />
            <button
              onClick={addNote}
              disabled={saving || !content.trim()}
              className="sm:shrink-0 bg-brand-900 hover:bg-brand-950 disabled:opacity-40 text-white text-xs font-semibold py-1.5 sm:py-1 px-3 rounded-lg"
            >
              {nt.addShort}
            </button>
          </div>
        </div>
      )}
    </Tag>
  )
}

function NoteCard({ note, onResolve, onUnresolve }: {
  note: NoteWithAuthors
  onResolve?: () => void
  onUnresolve?: () => void
}) {
  const author = personName(note.author?.name, note.author?.nickname) || nt.unknownAuthor
  return (
    <div className={`bg-surface-50 rounded-lg p-3 text-sm ${note.resolved ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2">
        <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded-full shrink-0 ${TAG_STYLES[note.tag]}`}>
          {note.tag}
        </span>
        <p className={`flex-1 text-brand-900 ${note.resolved ? 'line-through' : ''}`}>{note.content}</p>
        {onResolve && (
          <button onClick={onResolve} className="text-xs text-brand-900 font-medium hover:text-brand-900 font-semibold shrink-0">{nt.resolve}</button>
        )}
        {onUnresolve && (
          <button onClick={onUnresolve} className="text-xs text-brand-900 font-medium hover:text-brand-700 shrink-0">{nt.reopen}</button>
        )}
      </div>
      <p className="text-xs text-brand-950 font-medium mt-1">
        {author} · {format(new Date(note.created_at), 'MMM d · HH:mm')}
        {note.resolved && note.resolved_at && (
          <> · resolved by {personName(note.resolver?.name, note.resolver?.nickname) || 'unknown'} {format(new Date(note.resolved_at), 'MMM d')}</>
        )}
      </p>
    </div>
  )
}
