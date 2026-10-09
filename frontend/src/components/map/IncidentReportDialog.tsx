import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { IncidentKind } from '../../lib/api'

interface Props {
  point: [number, number]
  onClose: () => void
  onSubmit: (body: { kind: IncidentKind; lat: number; lng: number; occurred_at: string; severity?: number; note?: string }) => Promise<void>
}

function localDateTime() {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

export function IncidentReportDialog({ point, onClose, onSubmit }: Props) {
  const [kind, setKind] = useState<IncidentKind>('crash')
  const [occurredAt, setOccurredAt] = useState(localDateTime)
  const [severity, setSeverity] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('button, input, select, textarea')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
      if (event.key !== 'Tab' || !dialogRef.current) return
      const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'))
      if (!controls.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await onSubmit({ kind, lat: point[0], lng: point[1], occurred_at: new Date(occurredAt).toISOString(),
        ...(kind === 'crash' && severity ? { severity: Number(severity) } : {}), ...(note.trim() ? { note: note.trim() } : {}) })
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not submit this report.') }
    finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-[1400] grid place-items-end bg-navy/50 p-2 sm:place-items-center sm:p-4" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form ref={dialogRef} role="dialog" aria-modal="true" onSubmit={(e) => void submit(e)} aria-labelledby="incident-report-title" className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-navy/15 bg-white p-5 shadow-card sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs font-bold uppercase tracking-[.16em] text-brass-700">Traffic Police report</p><h2 id="incident-report-title" className="mt-1 font-serif text-2xl font-bold">Report an incident</h2></div>
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-navy/20 px-3 text-sm font-semibold">Close</button>
        </div>
        <p className="mt-2 text-sm text-navy/70">Location: {point[0].toFixed(5)}, {point[1].toFixed(5)}. Reports appear as pending activity until a City Planner reviews them. Do not include names or other personal details.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold">Report type<select value={kind} onChange={(e) => setKind(e.target.value as IncidentKind)} className="mt-1 min-h-11 w-full rounded-lg border border-navy/25 bg-white px-3"><option value="crash">Crash</option><option value="near_miss">Near miss</option></select></label>
          <label className="text-sm font-semibold">Date and time<input required type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-navy/25 px-3" /></label>
          {kind === 'crash' && <label className="text-sm font-semibold">Severity, if known<select value={severity} onChange={(e) => setSeverity(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-navy/25 bg-white px-3"><option value="">Unknown</option><option value="1">1 · Minor</option><option value="2">2 · Moderate</option><option value="3">3 · Serious</option><option value="4">4 · Critical</option></select></label>}
          <label className="text-sm font-semibold sm:col-span-2">Short operational note <span className="font-normal text-navy/60">(optional)</span><textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} className="mt-1 w-full rounded-lg border border-navy/25 px-3 py-2" placeholder="Road condition or observed safety context" /></label>
        </div>
        {error && <p role="alert" className="mt-3 rounded-lg bg-brick/10 p-3 text-sm font-semibold text-brick">{error}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-navy/20 px-4 font-semibold">Cancel</button><button disabled={busy} className="min-h-11 rounded-lg bg-navy px-4 font-semibold text-ivory disabled:opacity-60">{busy ? 'Submitting…' : 'Submit report'}</button></div>
      </form>
    </div>
  )
}
