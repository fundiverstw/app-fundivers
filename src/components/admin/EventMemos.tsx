import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { MEMO_TAGS, type EventMemo, type MemoTag, type Profile } from '../../types/database'

const TAG_STYLES: Record<MemoTag, string> = {
  urgent:    'bg-rose-700 text-rose-100',
  payment:   'bg-amber-700 text-amber-100',
  gear:      'bg-sky-700 text-sky-100',
  logistics: 'bg-violet-700 text-violet-100',
  cert:      'bg-emerald-700 text-emerald-100',
  medical:   'bg-fuchsia-700 text-fuchsia-100',
  note:      'bg-slate-700 text-slate-200',
}

type MemoWithAuthors = EventMemo & {
  author: Pick<Profile, 'id' | 'display_name' | 'full_name'> | null
  resolver: Pick<Profile, 'id' | 'display_name' | 'full_name'> | null
}

interface Props {
  eventType: 'dive' | 'course'
  eventId: string
}

export function EventMemos({ eventType, eventId }: Props) {
  const { user } = useAuth()
  const [memos, setMemos] = useState<MemoWithAuthors[]>([])
  const [showResolved, setShowResolved] = useState(false)
  const [tag, setTag] = useState<MemoTag>('note')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  async function refetch() {
    const column = eventType === 'dive' ? 'eo_dive_id' : 'eo_course_id'
    const { data: rows } = await supabase
      .from('event_memos')
      .select('*')
      .eq(column, eventId)
      .order('created_at', { ascending: false })

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

    setMemos((rows ?? []).map(r => ({
      ...r,
      author: profMap.get(r.created_by) ?? null,
      resolver: r.resolved_by ? (profMap.get(r.resolved_by) ?? null) : null,
    })))
  }

  useEffect(() => { refetch() }, [eventType, eventId])

  async function addMemo() {
    if (!user || !content.trim()) return
    setSaving(true)
    const fk = eventType === 'dive'
      ? { eo_dive_id: eventId, eo_course_id: null }
      : { eo_dive_id: null, eo_course_id: eventId }
    await supabase.from('event_memos').insert({
      created_by: user.id,
      tag,
      content: content.trim(),
      ...fk,
    })
    setContent('')
    setTag('note')
    await refetch()
    setSaving(false)
  }

  async function resolve(memoId: string) {
    if (!user) return
    await supabase
      .from('event_memos')
      .update({
        resolved: true,
        resolved_by: user.id,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', memoId)
    await refetch()
  }

  async function unresolve(memoId: string) {
    await supabase
      .from('event_memos')
      .update({ resolved: false, resolved_by: null, resolved_at: null })
      .eq('id', memoId)
    await refetch()
  }

  const open = memos.filter(m => !m.resolved)
  const resolved = memos.filter(m => m.resolved)

  return (
    <section className="bg-slate-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">Memos</h2>
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
          <p className="text-xs text-slate-500">No open memos.</p>
        )}
        {open.map(m => (
          <MemoCard key={m.id} memo={m} onResolve={() => resolve(m.id)} />
        ))}
        {showResolved && resolved.map(m => (
          <MemoCard key={m.id} memo={m} onUnresolve={() => unresolve(m.id)} />
        ))}
      </div>

      <div className="pt-2 border-t border-slate-700 space-y-2">
        <div className="flex gap-2">
          <select
            value={tag}
            onChange={e => setTag(e.target.value as MemoTag)}
            className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-100"
          >
            {MEMO_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            type="text"
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="New memo…"
            className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
            onKeyDown={e => { if (e.key === 'Enter') addMemo() }}
          />
          <button
            onClick={addMemo}
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

function MemoCard({ memo, onResolve, onUnresolve }: {
  memo: MemoWithAuthors
  onResolve?: () => void
  onUnresolve?: () => void
}) {
  const author = memo.author?.display_name ?? memo.author?.full_name ?? 'unknown'
  return (
    <div className={`bg-slate-900/50 rounded-lg p-3 text-sm ${memo.resolved ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2">
        <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded-full shrink-0 ${TAG_STYLES[memo.tag]}`}>
          {memo.tag}
        </span>
        <p className={`flex-1 text-slate-100 ${memo.resolved ? 'line-through' : ''}`}>{memo.content}</p>
        {onResolve && (
          <button onClick={onResolve} className="text-xs text-slate-400 hover:text-emerald-400 shrink-0">✓ resolve</button>
        )}
        {onUnresolve && (
          <button onClick={onUnresolve} className="text-xs text-slate-400 hover:text-sky-400 shrink-0">↺ reopen</button>
        )}
      </div>
      <p className="text-xs text-slate-500 mt-1">
        {author} · {format(new Date(memo.created_at), 'MMM d · HH:mm')}
        {memo.resolved && memo.resolved_at && (
          <> · resolved by {memo.resolver?.display_name ?? memo.resolver?.full_name ?? 'unknown'} {format(new Date(memo.resolved_at), 'MMM d')}</>
        )}
      </p>
    </div>
  )
}
