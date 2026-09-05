import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../hooks/useToast'
import { edgeErrorMessage } from '../../lib/edge-invoke'
import { errorMessage } from '../../lib/errors'
import { t } from '../../i18n'

const b = t.admin.backup

interface BackupResult {
  filename: string
  table_count: number
  row_count: number
  zip_base64: string
}

// A copy of the shop's data the shop actually holds. Everything else in the app
// assumes the Supabase project is there; this is the one page that assumes it
// might not be — an account lost, a card that stopped paying, a project deleted
// by someone who had the password. The export-database-backup edge function
// reads every public table as service_role and returns one CSV per table zipped
// together, so what lands on the admin's disk opens in a spreadsheet without
// this app, this schema, or a database.
export function AdminBackupPage() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<{ tables: number; rows: number; at: string } | null>(null)

  async function downloadBackup() {
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('export-database-backup', { body: {} })
      if (error) throw new Error(await edgeErrorMessage(error as Error & { context?: unknown }))
      const res = data as BackupResult
      if (!res?.zip_base64) throw new Error(b.empty)

      const bytes = Uint8Array.from(atob(res.zip_base64), c => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
      const a = document.createElement('a')
      a.href = url
      a.download = res.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

      setLast({
        tables: res.table_count,
        rows:   res.row_count,
        at:     new Date().toLocaleString(),
      })
      toast.success(b.done(res.table_count, res.row_count))
    } catch (err) {
      toast.error(b.failed(errorMessage(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-white">{b.title}</h1>
        <p className="text-sm text-brand-100/80">{b.blurb}</p>
      </header>

      <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-4">
        <div className="space-y-2 text-sm text-brand-900">
          <p>{b.holds}</p>
          <p>{b.excludes}</p>
          {/* Raw amber, not a theme token: a warning about personal data has to
              stay legible on both the light and dark renderings of this panel. */}
          <p className="rounded-lg border border-amber-400 bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900">
            {b.personalData}
          </p>
        </div>

        <button
          type="button"
          onClick={downloadBackup}
          disabled={busy}
          className="w-full sm:w-auto bg-brand-900 hover:bg-brand-950 disabled:opacity-60 text-white text-sm font-semibold py-2 px-5 rounded-lg transition-colors"
        >
          {busy ? b.working : b.download}
        </button>

        {last && (
          <p className="text-xs text-brand-900/80">{b.lastRun(last.tables, last.rows, last.at)}</p>
        )}
      </div>
    </div>
  )
}
