import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import type { Profile } from '../../types/database'

interface Props {
  user: Profile
  /** All loaded profiles. Used to derive children, the current parent label,
   *  and the eligible-children pool for the picker. */
  allUsers: Profile[]
  /** Fires after a successful link/unlink so the parent page can refetch. */
  onChanged: () => void
}

// Admin-only family link UI. Renders inside an expanded diver card.
// Mirrors the schema rules from 20260514030000_parent_child_accounts.sql:
//   - One-level only — a child can't have children of its own.
//   - The would-be parent must itself be top-level.
//   - Self-link blocked.
// Eligibility is filtered client-side from the loaded profile list; the
// trigger is still the source of truth and will reject anything sneaky.
export function AdminFamilyPanel({ user, allUsers, onChanged }: Props) {
  const toast = useToast()
  const [linking, setLinking] = useState(false)
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const currentParent = useMemo(
    () => (user.parent_account ? allUsers.find(u => u.id === user.parent_account) ?? null : null),
    [user.parent_account, allUsers],
  )
  const children = useMemo(
    () => allUsers.filter(u => u.parent_account === user.id),
    [allUsers, user.id],
  )

  // Eligible to become THIS user's child:
  //   - role 'diver' (staff/admin are excluded — they manage themselves)
  //   - currently top-level (parent_account is null)
  //   - not this user
  //   - has no children of their own (otherwise the trigger blocks the link)
  const parentIdsInUse = useMemo(
    () => new Set(allUsers.map(u => u.parent_account).filter((x): x is string => !!x)),
    [allUsers],
  )
  const eligibleChildren = useMemo(() => {
    return allUsers.filter(u =>
      u.role === 'diver' &&
      u.parent_account === null &&
      u.id !== user.id &&
      !parentIdsInUse.has(u.id),
    )
  }, [allUsers, user.id, parentIdsInUse])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return eligibleChildren.slice(0, 20)
    return eligibleChildren
      .filter(u => `${u.name ?? ''} ${u.nickname ?? ''}`.toLowerCase().includes(q))
      .slice(0, 20)
  }, [filter, eligibleChildren])

  async function linkChild(childId: string) {
    setLinking(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ parent_account: user.id })
        .eq('id', childId)
      if (error) throw error
      toast.success('Child account linked')
      setFilter('')
      onChanged()
    } catch (err) {
      toast.error(`Could not link: ${errorMessage(err)}`)
    } finally {
      setLinking(false)
    }
  }

  async function unlink(childId: string) {
    setUnlinkingId(childId)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ parent_account: null })
        .eq('id', childId)
      if (error) throw error
      toast.success('Child account unlinked')
      onChanged()
    } catch (err) {
      toast.error(`Could not unlink: ${errorMessage(err)}`)
    } finally {
      setUnlinkingId(null)
    }
  }

  // Mode A: this diver is currently linked AS a child. Show their parent
  // and offer an Unlink-from-parent control. No add-child UI here — the
  // one-level rule means a child can't have children.
  if (user.parent_account) {
    const parentName = currentParent?.name ?? currentParent?.nickname ?? '(unknown)'
    return (
      <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-2" aria-label="Family">
        <h2 className="text-sm font-semibold text-red-600 uppercase tracking-wider">Family</h2>
        <p className="text-sm text-brand-900">
          Linked as a child of <strong>{parentName}</strong>.
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => unlink(user.id)}
            disabled={unlinkingId === user.id}
            className="text-xs bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold px-3 py-1 rounded-lg"
          >
            {unlinkingId === user.id ? 'Unlinking…' : 'Unlink from parent'}
          </button>
        </div>
      </section>
    )
  }

  // Mode B: this diver is top-level — list any children + offer the picker.
  return (
    <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3" aria-label="Family">
      <h2 className="text-sm font-semibold text-red-600 uppercase tracking-wider">Family</h2>

      {children.length === 0 ? (
        <p className="text-xs text-brand-950 font-medium italic">No linked child accounts.</p>
      ) : (
        <ul className="space-y-1">
          {children.map(c => (
            <li key={c.id} className="flex items-center justify-between gap-2 bg-surface-50 border border-surface-200 rounded-lg px-3 py-2">
              <span className="text-sm text-brand-900 font-medium">
                {c.name ?? '(unnamed)'}
                {c.nickname && c.nickname !== c.name && (
                  <span className="text-brand-900/80"> ({c.nickname})</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => unlink(c.id)}
                disabled={unlinkingId === c.id}
                aria-label={`Unlink ${c.name ?? 'child'}`}
                className="text-xs text-red-700 hover:text-red-800 font-semibold disabled:opacity-50"
              >
                {unlinkingId === c.id ? 'Unlinking…' : 'Unlink'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="pt-2 border-t border-surface-200 space-y-2">
        <p className="text-xs text-brand-900 font-medium">
          Link an existing diver account as a child of this account:
        </p>
        <input
          type="search"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Search by name…"
          aria-label="Search divers"
          className="w-full bg-white border border-surface-300 rounded-lg px-3 py-1.5 text-sm text-brand-900 focus:outline-none focus:border-brand-900"
        />
        {filtered.length === 0 ? (
          <p className="text-xs text-brand-950 font-medium italic">
            {filter.trim() ? 'No matching eligible divers.' : 'No eligible divers to link.'}
          </p>
        ) : (
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {filtered.map(c => (
              <li key={c.id} className="flex items-center justify-between gap-2 bg-white border border-surface-200 rounded-lg px-3 py-1.5">
                <span className="text-sm text-brand-900 font-medium">
                  {c.name ?? '(unnamed)'}
                  {c.nickname && c.nickname !== c.name && (
                    <span className="text-brand-900/80"> ({c.nickname})</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => linkChild(c.id)}
                  disabled={linking}
                  aria-label={`Link ${c.name ?? 'diver'} as child`}
                  className="text-xs bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white font-semibold px-3 py-1 rounded-lg"
                >
                  Link as child
                </button>
              </li>
            ))}
          </ul>
        )}
        {!filter.trim() && eligibleChildren.length > 20 && (
          <p className="text-xs text-brand-950/70 font-medium italic">
            Showing first 20 — refine the search to narrow.
          </p>
        )}
      </div>
    </section>
  )
}
