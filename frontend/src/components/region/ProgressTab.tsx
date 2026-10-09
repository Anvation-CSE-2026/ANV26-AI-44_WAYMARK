import { useMemo, useState } from 'react'
import { useApi } from '../../hooks/useApi'
import { opsApi } from '../../lib/opsApi'
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
        className="w-full rounded-[12px] border border-navy/15 bg-white p-3 text-left shadow-card hover:border-brass"
      >
        <span className="block font-semibold leading-snug">{m.title}</span>
        <span className="mt-1 block text-sm text-navy/70">{categoryLabel(fx, m.category)}</span>
        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-navy/65">
          <span>{m.cell_ids.length} cell{m.cell_ids.length === 1 ? '' : 's'}</span>
          <span>{m.evidence_count} photo{m.evidence_count === 1 ? '' : 's'}</span>
          <span>owner: {m.owner_role}</span>
        </span>
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
    <div className="space-y-6">
      {progressQ.error && <ErrorBanner message={progressQ.error} onRetry={progressQ.reload} />}
      {!p && progressQ.loading && <SkeletonBlock lines={6} />}

      {p && (
        <>
          <Card className="space-y-5 p-5">
            <SectionTitle>Plan progress</SectionTitle>
            {p.measures.length === 0 ? (
              <p className="text-navy/80">
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
          </Card>

          <RiskPanel progress={p} />

          {stale && (
            <div role="status" className="flex flex-wrap items-center gap-3 rounded-[12px] border border-brass/60 bg-brass/10 px-4 py-3">
              <span className="flex-1">
                The action plan has changed since the last report{latestReport ? ` (generated ${fmtDate(latestReport.created_at)})` : ' was made'}. Regenerate it so the PDF shows the current numbers.
              </span>
              <button type="button" onClick={onRegenerate} className="rounded-lg bg-navy px-4 py-2 font-semibold text-ivory hover:bg-navy-800">
                Regenerate report
              </button>
            </div>
          )}

          <section aria-labelledby="board-head" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionTitle id="board-head">Measures ({p.measures.length})</SectionTitle>
              {!adding && (
                <button type="button" onClick={() => setAdding(true)} className="rounded-lg border border-navy/25 bg-white px-4 py-2 font-semibold hover:bg-ivory-200">
                  + Add measure manually
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
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {STATUS_ORDER.map((s) => (
                <section key={s} aria-labelledby={`col-${s}`} className="rounded-[12px] bg-navy/5 p-3">
                  <h4 id={`col-${s}`} className="mb-2 flex items-center justify-between font-semibold">
                    <StatusChip status={s} />
                    <span className="text-sm text-navy/70">{grouped[s].length}</span>
                  </h4>
                  {grouped[s].length === 0 ? (
                    <p className="px-1 py-2 text-sm text-navy/55">Nothing here.</p>
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
