import { useMemo, useState } from 'react'
import { useAuth } from '../../context/auth'
import { useApi } from '../../hooks/useApi'
import { opsApi } from '../../lib/opsApi'
import { ROLE_LABELS } from '../../lib/types.ops'
import type { Measure, MeasureStatus } from '../../lib/types.ops'
import { Card, ErrorBanner, SkeletonBlock } from '../ui'
import { SectionTitle } from '../ops/bits'
import { ProgressBar, StatusChip } from '../ops/ProgressBar'
import type { ToastData } from '../ops/Toast'
import { STATUS_META, STATUS_ORDER, categoryLabel, fmtDate, useEffects } from '../ops/util'
import { AddMeasureForm } from './AddMeasureForm'
import { MeasureDrawer } from './MeasureDrawer'
import { RiskPanel } from './RiskPanel'

const DEFAULT_STAGE: Record<string, number> = { planned: 0, in_progress: 0.25, evidence_submitted: 0.75, verified: 1 }

function MeasureCard({ m, fx, onOpen }: { m: Measure; fx: ReturnType<typeof useEffects>; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group w-full rounded-xl border border-navy/10 bg-white p-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brass/50 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass motion-reduce:transform-none motion-reduce:transition-none"
      >
        <span className="block font-bold leading-snug text-navy group-hover:text-teal">{m.title}</span>
        <span className="mt-1.5 block text-xs font-medium text-navy/60">{categoryLabel(fx, m.category)}</span>
        {m.due_at && <span className="mt-2 block text-xs font-semibold text-brass-700">Target · {fmtDate(m.due_at)}</span>}
        {m.progress_note && <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-navy/65">{m.progress_note}</span>}
        <span className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-navy/60">
          <span className="rounded-full bg-ivory px-2 py-1">{m.cell_ids.length} cell{m.cell_ids.length === 1 ? '' : 's'}</span>
          <span className="rounded-full bg-ivory px-2 py-1">{m.evidence_count} photo{m.evidence_count === 1 ? '' : 's'}</span>
          <span className="rounded-full bg-teal/10 px-2 py-1 text-teal">{ROLE_LABELS[m.owner_role]}</span>
        </span>
        <span className="mt-3 flex items-center justify-between border-t border-navy/5 pt-2 text-xs font-bold text-teal"><span>View measure</span><span aria-hidden="true">→</span></span>
      </button>
    </li>
  )
}

export function ProgressTab({
  kind,
  regionKey,
  reloadKey,
  onRegenerate,
  notify,
}: {
  kind: string
  regionKey: string
  reloadKey: number
  onRegenerate: () => void
  notify: (message: ToastData['message'], actionLabel?: string, onAction?: () => void) => void
}) {
  const fx = useEffects()
  const { user } = useAuth()
  const [local, setLocal] = useState(0)
  const progressQ = useApi((signal) => opsApi.progress(kind, regionKey, signal), [kind, regionKey, reloadKey, local], { keepPrevious: true })
  const reportsQ = useApi((signal) => opsApi.listReports(kind, regionKey, signal), [kind, regionKey, reloadKey, local], { keepPrevious: true })
  const [openId, setOpenId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const p = progressQ.data

  const stage = fx?.stage_factors ?? DEFAULT_STAGE
  const grouped = useMemo(() => {
    const g: Record<MeasureStatus, Measure[]> = { planned: [], in_progress: [], evidence_submitted: [], verified: [], cancelled: [] }
    for (const m of p?.measures ?? []) g[m.status].push(m)
    return g
  }, [p])

  // A report is out of date once any measure has changed after it was generated.
  const latestReport = reportsQ.data?.find((r) => r.status === 'ready')
  const stale = useMemo(() => {
    if (!p || p.measures.length === 0) return false
    if (!latestReport) return true
    const made = Date.parse(latestReport.created_at)
    return p.measures.some((m) => Date.parse(m.updated_at) > made)
  }, [p, latestReport])

  const changed = () => setLocal((n) => n + 1)

  return (
    <div className="space-y-6 pb-6">
      {progressQ.error && <ErrorBanner message={progressQ.error} onRetry={progressQ.reload} />}
      {!p && progressQ.loading && <SkeletonBlock lines={6} />}

      {p && (
        <>
          <Card className="overflow-hidden rounded-2xl border-navy/10">
            <div className="flex flex-wrap items-end justify-between gap-3 bg-navy px-5 py-4 text-ivory sm:px-6">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brass-soft">Implementation tracking</p>
                <SectionTitle>Plan progress</SectionTitle>
              </div>
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold">{p.measures.length} measure{p.measures.length === 1 ? '' : 's'}</span>
            </div>
            <div className="space-y-5 p-4 sm:p-6">
            {p.measures.length === 0 ? (
              <p className="rounded-xl border border-dashed border-navy/20 bg-ivory/70 px-5 py-6 text-sm leading-relaxed text-navy/75">
                No measures yet. Ask the assistant for recommendations and add them to the plan, or add one manually below.
              </p>
            ) : (
              <div className="grid gap-5 md:grid-cols-2">
                <ProgressBar
                  label="Implementation"
                  value={p.implementation_pct}
                  variant="segmented"
                  segments={p.measures.map((m) => ({ id: m.id, title: `${m.title}: ${STATUS_META[m.status].label}`, fill: stage[m.status] ?? 0 }))}
                  hint="How far the measures have got (planned 0%, in progress 25%, evidence submitted 75%, verified 100%). Photos move this bar."
                />
                <ProgressBar
                  label="Verified mitigation"
                  value={p.verified_pct}
                  variant="segmented"
                  segments={p.measures.map((m) => ({ id: m.id, title: `${m.title}: ${STATUS_META[m.status].label}`, fill: m.status === 'verified' ? 1 : 0 }))}
                  hint="Share of measures a planner has verified. Only these lower the adjusted risk."
                />
              </div>
            )}
            </div>
          </Card>

          <RiskPanel progress={p} />

          {stale && (
            <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-brass/40 bg-brass/10 px-4 py-4 shadow-sm">
              <span className="flex-1">
                The action plan has changed since the last report{latestReport ? ` (generated ${fmtDate(latestReport.created_at)})` : ' was made'}. Regenerate it so the PDF shows the current numbers.
              </span>
              <button type="button" onClick={onRegenerate} className="rounded-lg bg-navy px-4 py-2 font-semibold text-ivory hover:bg-navy-800">
                Regenerate report
              </button>
            </div>
          )}

          <section aria-labelledby="board-head" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brass-700">Work board</p>
                <SectionTitle id="board-head">Measures</SectionTitle>
              </div>
              {!adding && (user?.role === 'planner' || user?.role === 'engineer') && (
                <button type="button" onClick={() => setAdding(true)} className="rounded-xl bg-navy px-4 py-2.5 text-sm font-bold text-ivory shadow-sm transition hover:bg-navy-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass">
                  + Add a measure
                </button>
              )}
            </div>
            {adding && (
              <AddMeasureForm
                region={p.region}
                fx={fx}
                onCancel={() => setAdding(false)}
                onCreated={(title) => {
                  setAdding(false)
                  changed()
                  notify(`Added to the action plan: ${title}`)
                }}
              />
            )}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {STATUS_ORDER.map((s) => (
                <section key={s} aria-labelledby={`col-${s}`} className="min-w-0 rounded-2xl border border-navy/10 bg-white/65 p-3 shadow-sm">
                  <h4 id={`col-${s}`} className="mb-3 flex items-center justify-between gap-2 border-b border-navy/10 pb-3 font-semibold">
                    <StatusChip status={s} />
                    <span className="grid h-7 min-w-7 place-items-center rounded-full bg-navy/5 px-2 text-xs font-bold text-navy/70">{grouped[s].length}</span>
                  </h4>
                  {grouped[s].length === 0 ? (
                    <p className="rounded-lg border border-dashed border-navy/10 px-3 py-5 text-center text-xs text-navy/45">No measures at this stage.</p>
                  ) : (
                    <ul className="space-y-2">
                      {grouped[s].map((m) => (
                        <MeasureCard key={m.id} m={m} fx={fx} onOpen={() => setOpenId(m.id)} />
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          </section>
        </>
      )}

      {openId !== null && <MeasureDrawer measureId={openId} fx={fx} onClose={() => setOpenId(null)} onChanged={changed} />}
    </div>
  )
}
