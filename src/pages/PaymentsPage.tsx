import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import type { Payment } from '../types/database'

const STATUS_STYLES: Record<Payment['status'], string> = {
  pending: 'text-amber-400',
  paid: 'text-emerald-400',
  refunded: 'text-slate-400',
}

export function PaymentsPage() {
  const { user } = useAuth()
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    supabase
      .from('payments')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setPayments(data ?? [])
        setLoading(false)
      })
  }, [user])

  const totalOwed = payments
    .filter(p => p.status === 'pending')
    .reduce((sum, p) => sum + p.amount, 0)

  const totalPaid = payments
    .filter(p => p.status === 'paid')
    .reduce((sum, p) => sum + p.amount, 0)

  if (loading) {
    return <div className="flex justify-center pt-12"><div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-bold text-slate-100">Payments</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-800 rounded-xl p-4 text-center">
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Balance due</p>
          <p className="text-2xl font-bold text-amber-400">
            {payments[0]?.currency ?? 'TWD'} {totalOwed.toLocaleString()}
          </p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 text-center">
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Total paid</p>
          <p className="text-2xl font-bold text-emerald-400">
            {payments[0]?.currency ?? 'TWD'} {totalPaid.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Transaction list */}
      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">History</h2>
        {payments.length === 0
          ? <p className="text-slate-500 text-sm">No payment records yet.</p>
          : (
            <div className="space-y-2">
              {payments.map(p => (
                <div key={p.id} className="bg-slate-800 rounded-xl p-4 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm text-slate-100">{p.note ?? 'Payment'}</p>
                    <p className="text-xs text-slate-400">
                      {format(new Date(p.created_at), 'MMM d, yyyy')}
                      {p.method && ` · ${p.method}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-100">
                      {p.currency} {p.amount.toLocaleString()}
                    </p>
                    <p className={`text-xs font-medium capitalize ${STATUS_STYLES[p.status]}`}>{p.status}</p>
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </section>

      <p className="text-xs text-slate-500 text-center">
        Payments are recorded by FunDivers staff. Contact us if you see any discrepancies.
      </p>
    </div>
  )
}
