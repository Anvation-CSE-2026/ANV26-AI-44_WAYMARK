import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/auth'
import { useApi } from '../../hooks/useApi'
import { ApiError } from '../../lib/api'
import { opsApi } from '../../lib/opsApi'
import { ROLE_LABELS } from '../../lib/types.ops'
import type { EffectsOut, EvidenceKind, MeasureDetail, MeasureEvent } from '../../lib/types.ops'
import { ErrorBanner, SkeletonBlock } from '../ui'
import { StatusChip } from '../ops/ProgressBar'
import { SectionTitle } from '../ops/bits'
import { STATUS_META, STATUS_ORDER, categoryLabel, fmtDate } from '../ops/util'
import { EvidenceGallery } from './EvidenceGallery'
import { UploadZone } from './UploadZone'

function Stepper({ status }: { status: MeasureDetail['status'] }) {
  const current = STATUS_ORDER.indexOf(status)
  return (
    <ol aria-label="Progress of this measure" className="grid grid-cols-4 gap-1">
      {STATUS_ORDER.map((s, i) => {
        const done = i < current || status === 'verified'
        const isCurrent = i === current
        return (
          <li
            key={s}
            aria-current={isCurrent ? 'step' : undefined}
            className={`rounded-lg border px-2 py-2 text-center text-xs font-semibold sm:text-sm ${
              isCurrent ? 'border-navy bg-navy text-ivory' : done ? 'border-teal/50 bg-teal/10 text-teal' : 'border-navy/20 text-navy/60'
            }`}
          >
            <span aria-hidden="true" className="block text-base">{done && !isCurrent ? '✓' : STATUS_META[s].icon}</span>
            {STATUS_META[s].label}
            <span className="sr-only">{isCurrent ? ' (current step)' : done ? ' (done)' : ' (not reached)'}</span>
          </li>
        )
      })}
    </ol>
  )
}

const EVENT_ICON: Record<MeasureEvent['type'], string> = {
  created: '＋', transition: '→', comment: '✎', evidence: '▣', verify: '✓', reject: '↺',
}

function eventText(e: MeasureEvent): string {
  switch (e.type) {
    case 'created': return 'created this measure'
    case 'transition': return `moved it from ${e.from_status ?? '?'} to ${e.to_status}`
    case 'comment': return 'commented'
    case 'evidence': return 'added a photo'
    case 'verify': return 'approved the evidence (verified)'
    case 'reject': return 'sent it back for more work'
  }
}

export function MeasureDrawer({
  measureId,
  fx,
  onClose,
  onChanged,
}: {
  measureId: number
  fx: EffectsOut | null
  onClose: () => void
  /** Called after anything that can change the progress numbers. */
  onChanged: () => void
}) {
  const { user } = useAuth()
  const q = useApi((signal) => opsApi.getMeasure(measureId, signal), [measureId])
  const [fresh, setFresh] = useState<MeasureDetail | null>(null)
  const m = fresh ?? q.data
  const error = fresh ? null : q.error
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [progressNote, setProgressNote] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(true) // stays open once opened, so upload progress is not hidden
  const closeRef = useRef<HTMLButtonElement>(null)
  const opener = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement)

  const load = async () => {
    try {
      setFresh(await opsApi.getMeasure(measureId))
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not refresh this measure.')
    }
  }
  useEffect(() => {
    closeRef.current?.focus()
    const from = opener.current as HTMLElement | null
    return () => from?.focus?.()
  }, [])

  const act = async (fn: () => Promise<MeasureDetail>) => {
    setBusy(true)
    setActionError(null)
    try {
      setFresh(await fn())
      onChanged()
      return true
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'That did not work. Please try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }

  const role = user?.role
  const canMove = m?.allowed_next ?? []
  const canReview = m?.status === 'evidence_submitted' && role === 'planner'
  const required = m?.evidence_required ?? []
  const have = new Set(m?.evidence.map((e) => e.kind) ?? [])
  const missing = required.filter((k) => !have.has(k))
  const suggest: EvidenceKind = missing[0] ?? (have.has('after') ? 'during' : 'after')
  const open = m && m.status !== 'verified' && m.status !== 'cancelled'
  const canUpdatePlan = !!m && (role === 'planner' || (role === 'engineer' && m.owner_role === 'engineer'))
  useEffect(() => {
    setDueAt(m?.due_at ? new Date(m.due_at).toISOString().slice(0, 16) : '')
    setProgressNote(m?.progress_note ?? '')
  }, [m?.id, m?.due_at, m?.progress_note])

  const sendComment = async (e: FormEvent) => {
    e.preventDefault()
    if (!comment.trim() || !m) return
    setBusy(true)
    setActionError(null)
    try {
      await opsApi.comment(m.id, comment.trim())
      setComment('')
      await load()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'The comment could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[2500] flex justify-end bg-navy/50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        onKeyDown={onKey}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-2xl flex-col overflow-hidden bg-ivory shadow-card"
      >
        <div className="flex items-start justify-between gap-3 border-b border-navy/10 bg-white px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brass-700">Measure {measureId}</p>
            <h2 id="drawer-title" className="font-serif text-xl font-bold leading-snug">{m?.title ?? 'Loading…'}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="shrink-0 rounded-lg border border-navy/25 px-3 py-1.5 font-semibold hover:bg-ivory-200">
            Close <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div className="space-y-6 overflow-y-auto px-4 py-4">
          {!m && !error && <SkeletonBlock lines={6} />}
          {error && <ErrorBanner message={error} onRetry={q.reload} />}
          {m && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={m.status} />
                <span className="text-sm">{categoryLabel(fx, m.category)}</span>
                <span className="text-sm text-navy/70">· owner {ROLE_LABELS[m.owner_role]}</span>
                <span className="text-sm text-navy/70">· weight {m.effect_weight} {fx?.placeholder_weights ? '(placeholder)' : ''}</span>
              </div>
              {m.description && <p className="text-navy/85">{m.description}</p>}
              <div className="rounded-xl border border-navy/10 bg-white p-3">
                <p className="font-semibold">Implementation update</p>
                <p className="mt-1 text-sm text-navy/65">{m.due_at ? `Target date: ${fmtDate(m.due_at)}` : 'No target date set.'}</p>
                {m.progress_note && <p className="mt-2 whitespace-pre-wrap text-sm text-navy/80">{m.progress_note}</p>}
                {canUpdatePlan && open && <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-semibold">Target date<input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-navy/25 px-3 font-normal" /></label>
                  <label className="text-sm font-semibold sm:col-span-2">Progress update<textarea value={progressNote} onChange={(e) => setProgressNote(e.target.value)} maxLength={2000} rows={3} className="mt-1 w-full rounded-lg border border-navy/25 px-3 py-2 font-normal" placeholder="What was completed or what is blocked?" /></label>
                  <button type="button" disabled={busy} onClick={() => void act(() => opsApi.patchMeasure(m.id, { due_at: dueAt ? new Date(dueAt).toISOString() : null, progress_note: progressNote.trim() || null }))} className="min-h-11 rounded-lg bg-navy px-4 font-semibold text-ivory disabled:opacity-50 sm:col-span-2">Save implementation update</button>
                </div>}
              </div>
              <p className="text-sm text-navy/70">
                Cells:{' '}
                {m.cell_ids.map((c, i) => (
                  <span key={c}>
                    {i > 0 && ', '}
                    <Link to={`/map?cell=${encodeURIComponent(c)}`} className="font-mono text-teal underline-offset-2 hover:underline">{c}</Link>
                  </span>
                ))}
              </p>

              <Stepper status={m.status} />
              {m.status === 'cancelled' && <p className="rounded-lg bg-brick/10 px-3 py-2 font-semibold text-brick">✕ This measure was cancelled and no longer counts toward any percentage.</p>}

              {actionError && <p role="alert" className="rounded-lg border border-brick/40 bg-brick/10 px-3 py-2 font-semibold text-brick">{actionError}</p>}

              {/* ---------------- actions */}
              <section aria-labelledby="act-head" className="space-y-3">
                <SectionTitle id="act-head">What happens next</SectionTitle>
                {m.status === 'planned' && (
                  canMove.includes('in_progress') ? (
                    <button type="button" disabled={busy} onClick={() => void act(() => opsApi.patchMeasure(m.id, { status: 'in_progress' }))} className="rounded-lg bg-navy px-4 py-2 font-semibold text-ivory hover:bg-navy-800 disabled:opacity-60">
                      Start work
                    </button>
                  ) : (
                    <p className="text-navy/75">Waiting for a planner or engineer to start work on this measure.</p>
                  )
                )}
                {m.status === 'in_progress' && (
                  <>
                    <p className="text-navy/80">
                      Add photos below. An <strong>after</strong> photo submits the evidence automatically.
                      {missing.length > 0 && <> Still missing: <strong>{missing.join(', ')}</strong>.</>}
                    </p>
                    {canMove.includes('evidence_submitted') && (
                      <button type="button" disabled={busy || m.evidence_count === 0} onClick={() => void act(() => opsApi.patchMeasure(m.id, { status: 'evidence_submitted' }))} className="rounded-lg border border-navy/30 bg-white px-4 py-2 font-semibold hover:bg-ivory-200 disabled:opacity-50">
                        Submit evidence for review
                      </button>
                    )}
                  </>
                )}
                {m.status === 'evidence_submitted' && !canReview && <p className="text-navy/75">Evidence is submitted. A planner needs to review it before the measure counts as verified.</p>}
                {canReview && (
                  <div className="space-y-2 rounded-[12px] border border-navy/15 bg-white p-3">
                    <p className="font-semibold">Review the evidence</p>
                    <label className="block text-sm font-semibold">
                      Reason (required to reject)
                      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={2000} className="mt-1 w-full rounded-lg border border-navy/25 px-3 py-2 font-normal" />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy} onClick={() => void act(() => opsApi.verify(m.id, { decision: 'approve', reason: reason.trim() || undefined })).then((ok) => ok && setReason(''))} className="rounded-lg bg-teal px-4 py-2 font-semibold text-white hover:brightness-95 disabled:opacity-60">
                        ✓ Approve
                      </button>
                      <button type="button" disabled={busy || !reason.trim()} aria-describedby="reject-hint" onClick={() => void act(() => opsApi.verify(m.id, { decision: 'reject', reason: reason.trim() })).then((ok) => ok && setReason(''))} className="rounded-lg border border-brick/60 bg-white px-4 py-2 font-semibold text-brick hover:bg-brick/10 disabled:opacity-50">
                        ↺ Reject
                      </button>
                    </div>
                    <p id="reject-hint" className="text-xs text-navy/65">Rejecting sends the measure back to “in progress” and needs a reason. You cannot review a measure you created or whose photos you uploaded.</p>
                  </div>
                )}
                {m.status === 'verified' && <p className="rounded-lg bg-teal/10 px-3 py-2 font-semibold text-teal">✓ Verified. This measure now counts toward the adjusted risk estimate.</p>}

                {open && canUpdatePlan && (
                  confirmCancel ? (
                    <span className="inline-flex items-center gap-2">
                      <button type="button" disabled={busy} onClick={() => void act(() => opsApi.cancelMeasure(m.id)).then(() => setConfirmCancel(false))} className="rounded-lg bg-brick px-3 py-1.5 text-sm font-semibold text-white">Yes, cancel this measure</button>
                      <button type="button" onClick={() => setConfirmCancel(false)} className="rounded-lg border border-navy/25 px-3 py-1.5 text-sm font-semibold">Keep it</button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirmCancel(true)} className="text-sm font-semibold text-brick underline-offset-2 hover:underline">Cancel this measure…</button>
                  )
                )}
              </section>

              {/* ---------------- evidence */}
              <section aria-labelledby="ev-head" className="space-y-3">
                <SectionTitle id="ev-head">Photo evidence ({m.evidence_count})</SectionTitle>
                {required.length > 0 && (
                  <p className="text-sm text-navy/75">
                    This type of measure asks for: {required.map((k) => (have.has(k) ? `✓ ${k}` : `○ ${k}`)).join(' · ')}. Approval needs at least an “after” photo.
                  </p>
                )}
                <EvidenceGallery evidence={m.evidence} />
                {open && (role === 'planner' || (role === 'engineer' && m.owner_role === 'engineer')) ? (
                  <details open={uploadOpen} onToggle={(e) => setUploadOpen(e.currentTarget.open)} className="rounded-[12px] border border-navy/15 bg-white p-3">
                    <summary className="cursor-pointer font-semibold">Add photos</summary>
                    <div className="mt-3">
                      <UploadZone measureId={m.id} suggestKind={suggest} onUploaded={() => { void load(); onChanged() }} />
                    </div>
                  </details>
                ) : (
                  <p className="text-sm text-navy/65">{open ? `Only the assigned ${ROLE_LABELS[m.owner_role]} can add implementation evidence.` : `This measure is ${m.status}, so it no longer accepts photos.`}</p>
                )}
              </section>

              {/* ---------------- timeline and comments */}
              <section aria-labelledby="tl-head" className="space-y-3">
                <SectionTitle id="tl-head">Timeline and comments</SectionTitle>
                <ol className="space-y-2">
                  {m.events.map((e) => (
                    <li key={e.id} className="flex gap-3">
                      <span aria-hidden="true" className="mt-0.5 w-5 shrink-0 text-center text-teal">{EVENT_ICON[e.type]}</span>
                      <div className="min-w-0">
                        <p className="text-sm">
                          <strong>{e.actor}</strong> <span className="text-navy/65">({e.actor_role})</span> {eventText(e)}
                          <span className="ml-2 text-xs text-navy/55">{fmtDate(e.created_at)}</span>
                        </p>
                        {e.note && <p className={`text-sm ${e.type === 'comment' ? 'rounded-lg bg-white px-3 py-1.5' : 'text-navy/75'}`}>{e.note}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
                <form onSubmit={sendComment} className="flex flex-wrap items-end gap-2">
                  <label className="min-w-0 flex-1 text-sm font-semibold">
                    {role === 'community' ? 'Add an operational observation' : 'Add a comment'}
                    <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} className="mt-1 w-full rounded-lg border border-navy/25 px-3 py-2 font-normal" />
                  </label>
                  <button type="submit" disabled={busy || !comment.trim()} className="rounded-lg bg-navy px-4 py-2 font-semibold text-ivory hover:bg-navy-800 disabled:opacity-50">Post</button>
                </form>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
