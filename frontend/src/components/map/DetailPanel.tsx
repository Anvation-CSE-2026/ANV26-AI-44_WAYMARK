import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronDown, Info } from 'lucide-react'
import type { CellDetail, WhatIfCell } from '../../lib/api'
import { fmtInt, fmtNum, fmtProb, fmtPts } from '../../lib/format'
import { ConfidenceBadge, ErrorBanner, SkeletonBlock } from '../ui'
import { ShapChart } from './ShapChart'

interface Props {
  cellId: string
  detail: CellDetail | null
  loading: boolean
  error: string | null
  onRetry: () => void
  onClose: () => void
  /** Scenario values for this cell when a what-if scenario is active. */
  scenario: WhatIfCell | null
  scenarioLabel: string
}

function Stat({ label, value, primary = false }: { label: string; value: string; primary?: boolean }) {
  return (
    <div className={primary ? 'col-span-2 rounded-xl border-2 border-brass/70 bg-brass/10 px-4 py-3 shadow-sm' : 'rounded-lg bg-ivory-200/70 px-3 py-2'}>
      <dt className={primary ? 'text-sm font-bold uppercase tracking-wide text-navy/75' : 'text-xs font-semibold uppercase tracking-wide text-navy/60'}>{label}</dt>
      <dd className={primary ? 'mt-0.5 font-serif text-3xl font-bold leading-tight text-navy' : 'mt-0.5 text-lg font-bold'}>{value}</dd>
    </div>
  )
}

const BASIS_MARK = ' Basis: '

/** Each action is "Suggestion. Basis: the cell's own evidence." The evidence is shown beneath the suggestion. */
function splitBasis(a: string): { action: string; basis: string | null } {
  const i = a.indexOf(BASIS_MARK)
  if (i < 0) return { action: a, basis: null }
  return { action: a.slice(0, i).replace(/\.$/, ''), basis: a.slice(i + BASIS_MARK.length) }
}

function Actions({ items }: { items: string[] }) {
  const [done, setDone] = useState<Record<number, boolean>>({})
  return (
    <ul className="space-y-2">
      {items.map((raw, i) => {
        const { action, basis } = splitBasis(raw)
        return (
          <li key={i}>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-ivory-200/70">
              <input
                type="checkbox"
                checked={!!done[i]}
                onChange={(e) => setDone((d) => ({ ...d, [i]: e.target.checked }))}
                className="mt-1 h-5 w-5 shrink-0 accent-[#2A7F8E]"
              />
              <span className={done[i] ? 'text-navy/50 line-through' : ''}>
                {action}
                {basis && <details className="mt-1 text-xs text-navy/70"><summary className="min-h-7 cursor-pointer font-semibold">Why this action?</summary><span className="block pb-1">{basis}</span></details>}
              </span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

const STATUS_TEXT: Record<string, string> = {
  planned: '○ Planned',
  in_progress: '◐ In progress',
  evidence_submitted: '◕ Evidence submitted',
  verified: '● Verified',
}

const STATUS_PROGRESS: Record<string, number> = { planned: 0, in_progress: 25, evidence_submitted: 75, verified: 100 }

/** Additive section: the cell's action-plan measures and its base versus adjusted (estimate) score. */
function MeasuresSection({ detail }: { detail: CellDetail }) {
  if (!detail.has_measures || detail.measures.length === 0) return null
  const regions = [...new Map(detail.measures.map((m) => [`${m.region_kind}|${m.region_key}`, m])).values()]
  return (
    <section aria-labelledby="cell-measures" className="rounded-lg border border-brass/50 bg-brass/10 px-2.5 py-2.5">
      <h3 id="cell-measures" className="text-sm font-bold">Measures · {detail.measures.length}</h3>
      <details className="mt-2 text-xs text-navy/70">
        <summary className="flex min-h-7 cursor-pointer items-center gap-1 font-semibold"><Info aria-hidden="true" className="h-3.5 w-3.5" /> More info <ChevronDown aria-hidden="true" className="ml-auto h-3.5 w-3.5" /></summary>
        <p className="pb-1 pl-5">Projection follows measure stage and is an estimate, not a model rerun. Only planner-verified measures lower confirmed adjusted risk.</p>
      </details>
      <ul className="mt-2 space-y-1.5">
        {detail.measures.map((m) => (
          <li key={m.id} className="rounded-lg bg-white/80 px-2.5 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <span className="font-semibold">{m.title}</span>
              <span className="rounded-full border border-navy/15 px-2 py-0.5 text-[11px] font-semibold">{STATUS_TEXT[m.status] ?? m.status}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-navy/10" aria-hidden="true"><div className="h-full rounded-full bg-brass" style={{ width: `${STATUS_PROGRESS[m.status] ?? 0}%` }} /></div>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        {regions.map((m) => (
          <Link
            key={`${m.region_kind}|${m.region_key}`}
            to={`/region/${encodeURIComponent(m.region_key)}?kind=${encodeURIComponent(m.region_kind)}&tab=progress`}
            aria-label="Open region Progress plan"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-navy/25 bg-white px-2.5 py-1.5 text-xs font-semibold text-teal hover:bg-ivory-200 sm:text-sm"
          >
            Progress plan <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        ))}
      </div>
    </section>
  )
}

export function DetailPanel({ cellId, detail, loading, error, onRetry, onClose, scenario, scenarioLabel }: Props) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [cellId])

  const baseline = scenario?.baseline ?? detail?.baseline_prob ?? null
  const delta = scenario && scenario.scenario !== null && baseline !== null ? scenario.scenario - baseline : null

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      aria-label={`Details for cell ${cellId}`}
      className="flex max-h-full flex-col overflow-hidden rounded-[12px] border border-navy/10 bg-white shadow-card outline-none"
    >
      <div className="flex items-start justify-between gap-2 border-b border-navy/10 px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brass-700">Cell</p>
          <h2 className="truncate font-mono text-base font-semibold">{cellId}</h2>
          <p className="mt-0.5 truncate text-xs font-medium text-navy/65" title={[detail?.street_name, detail?.locality].filter(Boolean).join(' · ')}>
            {[detail?.street_name, detail?.locality].filter(Boolean).join(' · ') || 'Street / locality unavailable'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close cell details"
          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-navy/20 px-2.5 py-1.5 text-xs font-semibold hover:bg-ivory-200 sm:text-sm"
        >
          Close <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className="space-y-3 overflow-y-auto px-3 py-3 sm:space-y-4 sm:px-4 sm:py-4">
        {loading && <SkeletonBlock lines={7} />}
        {error && <ErrorBanner message={error} onRetry={onRetry} />}

        {detail && (
          <>
            <div>
              {detail.history_percentile !== null ? (
                <p className="font-serif text-xl font-bold leading-snug">
                  Historically riskier than {Math.round(detail.history_percentile)}% of similar cells
                </p>
              ) : (
                <p className="font-serif text-lg font-bold leading-snug">Similar-cell comparison unavailable</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <ConfidenceBadge value={detail.confidence} />
                {detail.emerging_risk && (
                  <span className="rounded-full border border-brick/40 bg-brick/10 px-2.5 py-0.5 text-xs font-semibold text-brick">
                    Emerging · audit
                  </span>
                )}
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-2">
              <Stat
                label={scenario ? `${scenarioLabel} likelihood · estimate` : 'Blackspot likelihood'}
                value={fmtProb(scenario ? scenario.scenario : detail.baseline_prob)}
                primary
              />
              <Stat label="Past crashes" value={fmtInt(detail.n_past_crashes)} />
              <Stat label="Baseline" value={fmtNum(detail.risk_score, 3)} />
              <Stat label="Verified" value={fmtNum(detail.adjusted_risk_score, 3)} />
              <Stat label="Projected · est." value={fmtNum(detail.projected_risk_score, 3)} />
            </dl>
            {scenario && (
              <section aria-live="polite" className="rounded-lg border border-brass/50 bg-brass/10 px-3 py-2.5">
                <h3 className="text-sm font-bold">{scenarioLabel} scenario · estimate</h3>
                <p className="mt-0.5 text-sm">
                  Baseline {fmtProb(baseline)} <span aria-hidden="true">→</span>{' '}
                  <span className="font-semibold">{fmtProb(scenario.scenario)}</span>
                  <span className="ml-2 text-navy/70">({fmtPts(delta)})</span>
                </p>
                <details className="mt-1 text-xs text-navy/70">
                  <summary className="min-h-7 cursor-pointer font-semibold">What this means</summary>
                  <p className="pb-1">
                    {delta === null
                      ? 'No scenario value is available for this cell.'
                      : delta < 0
                        ? 'Under this scenario the modelled probability for this cell is lower than its baseline.'
                        : delta > 0
                          ? 'Under this scenario the modelled probability for this cell is higher than its baseline.'
                          : 'Under this scenario the modelled probability for this cell is unchanged.'} Scenario simulation, not a live forecast.
                  </p>
                </details>
              </section>
            )}
            <section aria-label="Incident activity" className="rounded-xl border border-navy/10 bg-ivory-100 p-2.5">
              <h3 className="text-sm font-bold">Incident activity</h3>
              <dl className="mt-1.5 grid grid-cols-2 gap-1.5 text-sm">
                <div className="rounded-lg bg-white px-2.5 py-1.5"><dt className="text-[10px] font-semibold uppercase tracking-wide text-teal">Confirmed</dt><dd className="text-base font-bold">{detail.incident_confirmed_count ?? 0}</dd></div>
                <div className="rounded-lg bg-white px-2.5 py-1.5"><dt className="text-[10px] font-semibold uppercase tracking-wide text-brass-700">Pending</dt><dd className="text-base font-bold">{detail.incident_pending_count ?? 0}</dd></div>
              </dl>
              <details className="mt-1.5 text-xs text-navy/65"><summary className="flex min-h-7 cursor-pointer items-center gap-1 font-semibold"><Info aria-hidden="true" className="h-3.5 w-3.5" /> More info <ChevronDown aria-hidden="true" className="ml-auto h-3.5 w-3.5" /></summary><p className="pb-1 pl-5">Reported activity is separate from the historical model score. Pending reports await City Planner review.</p></details>
            </section>
            <details className="text-xs text-navy/65"><summary className="flex min-h-7 cursor-pointer items-center gap-1 font-semibold"><Info aria-hidden="true" className="h-3.5 w-3.5" /> About this score <ChevronDown aria-hidden="true" className="ml-auto h-3.5 w-3.5" /></summary><p className="pb-1 pl-5">Historical backtest likelihood of reaching three or more crashes. This is not a calibrated live forecast.</p></details>

            {detail.confidence_explanation && (
              <details className="text-sm">
                <summary className="min-h-8 cursor-pointer font-semibold">Why this confidence?</summary>
                <p className="pb-1 text-navy/80">{detail.confidence_explanation}</p>
              </details>
            )}

            <MeasuresSection detail={detail} />

            <section>
              <h3 className="mb-1 text-sm font-bold">Score factors</h3>
              {detail.shap.length > 0 ? (
                <>
                  <ShapChart rows={detail.shap} />
                  <details className="mt-1 text-xs text-navy/65"><summary className="min-h-7 cursor-pointer font-semibold">About these factors</summary><p className="pb-1">Bars show how historical features moved the score; they do not prove cause.</p></details>
                </>
              ) : (
                <p className="text-xs text-navy/70">No factor breakdown available.</p>
              )}
            </section>

            {detail.recommendations.length > 0 && (
              <section>
                <h3 className="mb-1 text-sm font-bold">Suggested actions</h3>
                <details className="mb-1 text-xs text-navy/70"><summary className="min-h-7 cursor-pointer font-semibold">About recommendations</summary><p className="pb-1">Based on this cell's crash records; use as a site-audit prompt, not a diagnosis of cause.</p></details>
                <Actions key={detail.cell_id} items={detail.recommendations} />
              </section>
            )}

            <a
              href={detail.google_maps_url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open this cell in Google Maps"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-ivory hover:bg-navy-800"
            >
              Open in Google Maps <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </>
        )}
      </div>
    </aside>
  )
}
