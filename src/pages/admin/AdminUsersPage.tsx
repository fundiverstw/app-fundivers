import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../types/database'

export function AdminUsersPage() {
  const [users, setUsers] = useState<Profile[]>([])
  const [filter, setFilter] = useState('')

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .order('full_name', { ascending: true })
      .then(({ data }) => setUsers((data ?? []) as Profile[]))
  }, [])

  const visible = users.filter(u => {
    if (!filter) return true
    const haystack = [u.full_name, u.display_name, u.contact_id, u.phone, u.cert_number]
      .filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(filter.toLowerCase())
  })

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-slate-100">People</h1>

      <input
        type="text"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="Search by name, contact, cert…"
        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 text-sm focus:outline-none focus:border-sky-500"
      />

      <div className="space-y-2">
        {visible.map(u => (
          <div key={u.id} className="bg-slate-800 rounded-xl p-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-slate-100 text-sm">
                  {u.full_name ?? '(unnamed)'}
                  {u.display_name && <span className="text-slate-400"> “{u.display_name}”</span>}
                </p>
                <p className="text-xs text-slate-400">
                  {u.cert_agency && u.cert_level ? `${u.cert_agency} ${u.cert_level}` : 'Uncertified'}
                  {u.logged_dives > 0 && ` · ${u.logged_dives} logged`}
                  {u.nitrox_certified && ' · Nitrox'}
                </p>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                u.role === 'admin' ? 'bg-amber-900 text-amber-300' : 'bg-sky-900 text-sky-300'
              }`}>
                {u.role}
              </span>
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <p className="text-slate-500 text-sm">No matches.</p>
        )}
      </div>
    </div>
  )
}
