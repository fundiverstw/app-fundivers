import { useCallback, useEffect, useState } from 'react'
import { personName } from '../../lib/names'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import type { DiverNote, Profile } from '../../types/database'
import { t } from '../../i18n'

const dn = t.admin.diverNotes

type NoteWithAuthor = DiverNote & {
  author: Pick<Profile, 'id' | 'nickname' | 'name'> | null
  editor: Pick<Profile, 'id' | 'nickname' | 'name'> | null
}

interface Props {
  profileId: string
  title?: string
}

export function DiverNotes({ profileId, title = dn.title }: Props) {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [notes, setNotes] = useState<NoteWithAuthor[]>([])
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')

  const refetch = useCallback(async () => {
    const { data: rows } = await supabase
      .from('diver_notes')
      .select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })

    const ids = [
      ...(rows ?? []).map(r => r.created_by),
      ...(rows ?? []).map(r => r.edited_by).filter((x): x is string => !!x),
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
      editor: r.edited_by ? (profMap.get(r.edited_by) ?? null) : null,
    })))
  }, [profileId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refetch() }, [refetch])

  async function addNote() {
    if (!user || !content.trim()) return
    setSaving(true)
    await supabase.from('diver_notes').insert({
      profile_id: profileId,
      created_by: user.id,
      content: content.trim(),
    })
    setContent('')
    await refetch()
    setSaving(false)
  }

  function startEdit(note: NoteWithAuthor) {
    setEditingId(note.id)
    setEditingContent(note.content)
  }

  async function saveEdit() {
    if (!user || !editingId || !editingContent.trim()) return
    await supabase
      .from('diver_notes')
      .update({
        content: editingContent.trim(),
        edited_by: user.id,
        edited_at: new Date().toISOString(),
      })
      .eq('id', editingId)
    setEditingId(null)
    setEditingContent('')
    await refetch()
  }

  function cancelEdit() {
    setEditingId(null)
    setEditingContent('')
  }

  async function deleteNote(id: string) {
    await supabase.from('diver_notes').delete().eq('id', id)
    await refetch()
  }

  function canMutate(note: NoteWithAuthor) {
    return isAdmin || note.created_by === user?.id
  }

  return (
    <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
      <h2 className="text-sm font-semibold text-red-600 uppercase tracking-wider">{title}</h2>

      <div className="space-y-2">
        {notes.length === 0 && (
          <p className="text-xs text-brand-950 font-medium">{dn.none}</p>
        )}
        {notes.map(n => (
          <div key={n.id} className="bg-surface-50 rounded-lg p-3 text-sm space-y-1">
            {editingId === n.id ? (
              <div className="space-y-2">
                <textarea
                  value={editingContent}
                  onChange={e => setEditingContent(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  aria-label={dn.editNoteAria}
                  className="w-full bg-white border border-surface-300 rounded-lg px-3 py-1.5 text-sm text-brand-900 focus:outline-none focus:border-brand-900"
                />
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={cancelEdit}
                    className="text-xs text-brand-900 font-medium hover:text-brand-900"
                  >
                    {dn.cancel}
                  </button>
                  <button
                    onClick={saveEdit}
                    disabled={!editingContent.trim()}
                    className="bg-brand-900 hover:bg-brand-950 disabled:opacity-40 text-white text-xs font-semibold py-1 px-3 rounded-lg"
                  >
                    {dn.save}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-2">
                  <p className="flex-1 text-brand-900 whitespace-pre-wrap">{n.content}</p>
                  {canMutate(n) && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => startEdit(n)}
                        aria-label={dn.editNoteFromAria(personName(n.author?.name, n.author?.nickname) || t.admin.notes.unknownAuthor)}
                        className="text-xs text-brand-900 font-semibold hover:text-brand-700"
                      >
                        {dn.edit}
                      </button>
                      <button
                        onClick={() => deleteNote(n.id)}
                        aria-label={dn.deleteNoteFromAria(personName(n.author?.name, n.author?.nickname) || t.admin.notes.unknownAuthor)}
                        className="text-xs text-red-700 font-semibold hover:text-red-800"
                      >
                        {dn.delete}
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-xs text-brand-950 font-medium">
                  {personName(n.author?.name, n.author?.nickname) || t.admin.notes.unknownAuthor} · {format(new Date(n.created_at), 'MMM d, yyyy · HH:mm')}
                  {n.edited_at && (
                    <>{dn.edited}{n.editor && dn.editedBy(personName(n.editor.name, n.editor.nickname))} {format(new Date(n.edited_at), 'MMM d')}</>
                  )}
                </p>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="pt-2 border-t border-surface-200 space-y-2">
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={dn.newNotePlaceholder}
          rows={2}
          maxLength={2000}
          aria-label={dn.newNoteAria}
          className="w-full bg-white border border-surface-300 rounded-lg px-3 py-1.5 text-sm text-brand-900 focus:outline-none focus:border-brand-900"
        />
        <div className="flex justify-end">
          <button
            onClick={addNote}
            disabled={saving || !content.trim()}
            className="bg-brand-900 hover:bg-brand-950 disabled:opacity-40 text-white text-xs font-semibold py-1 px-3 rounded-lg"
          >
            {dn.addNote}
          </button>
        </div>
      </div>
    </section>
  )
}
