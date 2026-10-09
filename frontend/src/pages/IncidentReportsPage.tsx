import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Card, ErrorBanner, LogoLoader } from '../components/ui'
import { useAuth } from '../context/auth'
import { opsApi } from '../lib/opsApi'
import type { IncidentReport } from '../lib/api'

const WORLD = '-90,-180,90,180'

export default function IncidentReportsPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<IncidentReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [rejectNotes, setRejectNotes] = useState<Record<number, string>>({})
  const reload = useCallback(async () => {
    setLoading(true); setError(null)
    try { setItems(await opsApi.incidents(WORLD)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load incident reports.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void reload() }, [reload])
  if (user?.role !== 'planner') return <Navigate to="/map" replace />

  async function review(row: IncidentReport, decision: 'confirm' | 'reject') {
    setBusyId(row.id); setError(null)
    try {
      await opsApi.reviewIncident(row.id, { decision, ...(decision === 'reject' ? { note: rejectNotes[row.id] ?? '' } : {}) })
      await reload()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not review this report.') }
    finally { setBusyId(null) }
  }
  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-5 sm:px-6 sm:py-8">
      <header className="rounded-2xl bg-navy p-5 text-ivory shadow-card sm:p-7">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-brass">City Planner workspace</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3"><div><h1 className="font-serif text-3xl font-bold">Incident review</h1><p className="mt-1 max-w-2xl text-sm text-ivory/70">Review Traffic Police crash and near-miss reports before they become confirmed incident records.</p></div><button type="button" onClick={() => void reload()} className="min-h-11 rounded-lg border border-white/25 px-4 font-semibold hover:bg-white/10">Refresh reports</button></div>
      </header>
      {error && <div className="mt-4"><ErrorBanner message={error} onRetry={() => void reload()} /></div>}
      {loading ? <div className="flex justify-center py-14"><LogoLoader label="Loading incident reports" /></div> : (
        <div className="mt-5 space-y-3">
          {!items.length && <Card className="p-6 text-center text-navy/70">No reports have been submitted yet.</Card>}
          {items.map((row) => <Card key={row.id} className="min-w-0 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-brass/15 px-3 py-1 text-xs font-bold uppercase text-brass-700">{row.kind === 'near_miss' ? 'Near miss' : 'Crash'}</span><span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${row.status === 'pending' ? 'bg-brass/15 text-brass-700' : row.status === 'confirmed' ? 'bg-teal/10 text-teal' : 'bg-brick/10 text-brick'}`}>{row.status}</span><span className="ml-auto text-xs text-navy/60">Report #{row.id}</span></div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2"><p><span className="block text-xs font-bold uppercase text-navy/55">Incident time</span><span>{new Date(row.occurred_at).toLocaleString()}</span></p><p><span className="block text-xs font-bold uppercase text-navy/55">Location</span><span className="break-all">Cell {row.cell_id} · {row.lat.toFixed(5)}, {row.lng.toFixed(5)}</span></p>{row.severity && <p><span className="block text-xs font-bold uppercase text-navy/55">Severity</span>{row.severity} / 4</p>}<p><span className="block text-xs font-bold uppercase text-navy/55">Submitted by</span>Traffic Police</p></div>
            {row.note && <p className="mt-3 rounded-lg bg-ivory-200/70 p-3 text-sm">{row.note}</p>}
            {row.review_note && <p className="mt-2 text-sm text-navy/70">Review note: {row.review_note}</p>}
            {row.status === 'pending' && <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]"><label className="text-xs font-semibold text-navy/70">Reason if rejecting<textarea value={rejectNotes[row.id] ?? ''} onChange={(e) => setRejectNotes((v) => ({ ...v, [row.id]: e.target.value }))} maxLength={1000} rows={2} className="mt-1 block w-full rounded-lg border border-navy/20 px-3 py-2 text-sm" /></label><button type="button" disabled={busyId === row.id} onClick={() => void review(row, 'confirm')} className="min-h-11 self-end rounded-lg bg-teal px-4 font-bold text-white disabled:opacity-50">{busyId === row.id ? 'Saving…' : 'Confirm report'}</button><button type="button" disabled={busyId === row.id || !(rejectNotes[row.id] ?? '').trim()} onClick={() => void review(row, 'reject')} className="min-h-11 self-end rounded-lg border border-brick/30 px-4 font-bold text-brick disabled:opacity-40">Reject</button></div>}
          </Card>)}
        </div>
      )}
    </div>
  )
}
