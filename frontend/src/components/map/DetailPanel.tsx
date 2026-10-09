import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
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
      {primary && <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brass-700">Primary risk indicator</p>}
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
                {basis && <span className="mt-0.5 block text-sm text-navy/70">Why: {basis}</span>}
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

/** Additive section: the cell's action-plan measures and its base versus adjusted (estimate) score. */
function MeasuresSection({ detail }: { detail: CellDetail }) {
  if (!detail.has_measures || detail.measures.length === 0) return null
  const base = detail.risk_score
  const adj = detail.adjusted_risk_score
  const regions = [...new Map(detail.measures.map((m) => [`${m.region_kind}|${m.region_key}`, m])).values()]
  return (
    <section aria-labelledby="cell-measures" className="rounded-lg border border-brass/50 bg-brass/10 px-3 py-3">
      <h3 id="cell-measures" className="text-base font-bold">Measures in this cell</h3>
      <p className="mt-1 text-lg">
        <span className="text-sm text-navy/70">Base score </span>
        <span className="font-semibold">{fmtNum(base, 1)}</span>
        <span aria-hidden="true"> → </span>
        <span className="sr-only"> to adjusted score </span>
        <span className="font-semibold">{adj === null ? '—' : fmtNum(adj, 1)}</span>
        <span className="ml-1 text-sm text-navy/70">(adjusted, estimate)</span>
      </p>
      <p className="mt-1 text-xs text-navy/70">
        Only verified measures lower the score. This is an overlay estimate, not a re-run of the model.
      </p>
      <ul className="mt-2 space-y-1.5">
        {detail.measures.map((m) => (
          <li key={m.id} className="rounded-md bg-white/80 px-2 py-1.5 text-sm">
            <span className="font-semibold">{m.title}</span>
            <span className="ml-2 inline-block rounded-full border border-navy/25 px-2 py-0.5 text-xs font-semibold">
              {STATUS_TEXT[m.status] ?? m.status}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        {regions.map((m) => (
          <Link
            key={`${m.region_kind}|${m.region_key}`}
            to={`/region/${encodeURIComponent(m.region_key)}?kind=${encodeURIComponent(m.region_kind)}&tab=progress`}
            className="rounded-lg border border-navy/25 bg-white px-3 py-1.5 text-sm font-semibold text-teal hover:bg-ivory-200"
          >
            Open the region's Progress tab
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
      <div className="flex items-start justify-between gap-3 border-b border-navy/10 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brass-700">Cell</p>
          <h2 className="truncate font-mono text-lg font-semibold">{cellId}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close cell details"
          className="shrink-0 rounded-lg border border-navy/20 px-3 py-1.5 text-sm font-semibold hover:bg-ivory-200"
        >
          Close <span aria-hidden="true">✕</span>
        </button>
      </div>

      <div className="space-y-5 overflow-y-auto px-4 py-4">
        {loading && <SkeletonBlock lines={7} />}
        {error && <ErrorBanner message={error} onRetry={onRetry} />}

        {detail && (
          <>
            <div>
              {detail.history_percentile !== null ? (
                <p className="font-serif text-2xl font-bold leading-snug">
                  Riskier than {Math.round(detail.history_percentile)}% of cells with similar history
                </p>
              ) : (
                <p className="font-serif text-2xl font-bold leading-snug">Comparison with similar history unavailable</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <ConfidenceBadge value={detail.confidence} />
                {detail.emerging_risk && (
                  <span className="rounded-full border border-brick/40 bg-brick/10 px-2.5 py-0.5 text-sm font-semibold text-brick">
                    Emerging risk
                  </span>
                )}
              </div>
            </div>

            {detail.emerging_risk ? (
              <div role="note" className="rounded-lg border-l-4 border-brick bg-brick/10 px-3 py-2.5 font-semibold text-brick">
                Elevated risk, recommend a site audit
              </div>
            ) : (
              <div role="note" className="rounded-lg border-l-4 border-slate-soft bg-ivory-200 px-3 py-2.5 text-navy/80">
                Not flagged as an emerging-risk cell. Scores are indicative only.
              </div>
            )}

            <dl className="grid grid-cols-2 gap-2">
              <Stat label="Blackspot likelihood" value={fmtProb(detail.baseline_prob)} primary />
              <Stat label="Past crashes" value={fmtInt(detail.n_past_crashes)} />
              <Stat label="Risk score" value={fmtNum(detail.risk_score, 3)} />
            </dl>
            <p className="text-xs leading-relaxed text-navy/65">
              Model-estimated likelihood of reaching the blackspot definition of 3 or more crashes in the historical
              evaluation year. This is a backtest score, not a calibrated live forecast.
            </p>

            {detail.confidence_explanation && (
              <section>
                <h3 className="text-base font-bold">Why this confidence level</h3>
                <p className="mt-1 text-navy/80">{detail.confidence_explanation}</p>
              </section>
            )}

            <MeasuresSection detail={detail} />

            {scenario && (
              <section aria-live="polite" className="rounded-lg border border-brass/50 bg-brass/10 px-3 py-3">
                <h3 className="text-base font-bold">Scenario: {scenarioLabel}</h3>
                <p className="mt-1 text-lg">
                  <span className="font-semibold">{fmtProb(baseline)}</span>
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only"> to </span>
                  <span className="font-semibold">{fmtProb(scenario.scenario)}</span>
                  <span className="ml-2 text-navy/70">({fmtPts(delta)})</span>
                </p>
                <p className="mt-1 text-sm text-navy/75">
                  {delta === null
                    ? 'No scenario value is available for this cell.'
                    : delta < 0
                      ? 'Under this scenario the modelled probability for this cell is lower than its baseline.'
                      : delta > 0
                        ? 'Under this scenario the modelled probability for this cell is higher than its baseline.'
                        : 'Under this scenario the modelled probability for this cell is unchanged.'}
                </p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-navy/60">
                  Scenario simulation, not a live forecast
                </p>
              </section>
            )}

            <section>
              <h3 className="mb-1 text-base font-bold">What drives this score</h3>
              <p className="mb-2 text-sm leading-relaxed text-navy/70">
                The model learned associations from earlier crash records. Bars show how each historical feature moved
                this cell's score; they do not prove that the feature caused crashes.
              </p>
              {detail.shap.length > 0 ? (
                <ShapChart rows={detail.shap} />
              ) : (
                <p className="rounded-lg bg-ivory-200/70 px-3 py-2 text-navy/75">
                  Factor contributions are stored for emerging-risk cells and the top-scoring cells. This cell has none
                  on record.
                </p>
              )}
            </section>

            {detail.recommendations.length > 0 && (
              <section>
                <h3 className="mb-1 text-base font-bold">Suggested actions</h3>
                <p className="mb-2 text-sm text-navy/70">
                  Shown only where this cell's own crash records show the condition. They are prompts for a site
                  audit, not a diagnosis of cause.
                </p>
                <Actions key={detail.cell_id} items={detail.recommendations} />
              </section>
            )}

            <a
              href={detail.google_maps_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2.5 font-semibold text-ivory hover:bg-navy-800"
            >
              Open in Google Maps <span aria-hidden="true">↗</span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </>
        )}
      </div>
    </aside>
  )
}
