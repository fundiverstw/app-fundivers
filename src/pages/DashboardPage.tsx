import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

interface Summary {
  diverCount: number
  pendingPayments: number
  upcomingBookings: number
}

export function AdminDashboard() {
  const { profile } = useAuth()
  const [s, setS] = useState<Summary | null>(null)

  useEffect(() => {
    ;(async () => {
      const [diversRes, pendingRes, upcomingRes] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'diver'),
        supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('bookings').select('id', { count: 'exact', head: true }).neq('status', 'cancelled'),
      ])
      setS({
        diverCount: diversRes.count ?? 0,
        pendingPayments: pendingRes.count ?? 0,
        upcomingBookings: upcomingRes.count ?? 0,
      })
    })()
  }, [])

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Welcome, {profile?.display_name ?? profile?.full_name}</h1>
        <p className="text-sm text-slate-400">Admin dashboard</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card label="Divers"     value={s?.diverCount} />
        <Card label="Bookings"   value={s?.upcomingBookings} />
        <Card label="Unpaid"     value={s?.pendingPayments} accent="text-amber-400" />
      </div>

      <section className="bg-slate-800 rounded-xl p-4 space-y-2">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Quick links</h2>
        <Link to="/admin/events" className="block text-sky-400 hover:underline text-sm">Manage events & registrations →</Link>
        <Link to="/admin/users"  className="block text-sky-400 hover:underline text-sm">Browse divers →</Link>
        <Link to="/calendar"     className="block text-slate-400 hover:text-slate-100 text-sm">Switch to diver view →</Link>
      </section>
    </div>
  )
}

function Card({ label, value, accent = 'text-slate-100' }: { label: string; value: number | undefined; accent?: string }) {
  return (
    <div className="bg-slate-800 rounded-xl p-4 text-center">
      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent}`}>{value ?? '—'}</p>
    </div>
  )
}
