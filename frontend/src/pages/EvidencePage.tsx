import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Legend as ChartLegend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import type { MetricRow } from '../lib/api'
import { useApi } from '../hooks/useApi'
import { MAP_PALETTE, fmtNum, prettyFeature } from '../lib/format'
import { Card, EmptyState, ErrorBanner, PageContainer, PageHeader, SkeletonBlock } from '../components/ui'

/** Metric differences smaller than this are shown as a tie. */
const TIE_EPS = 0.005

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

type Kind = 'overall' | 'low' | 'robust' | 'split' | 'interval' | 'other'

function readInterval(extra: Record<string, unknown>): [number, number] | null {
  const lowKeys = ['ci_low', 'ci_lower', 'ci_lo', 'lower', 'lo', 'low', 'lower_bound', 'p2_5', 'p025']
  const highKeys = ['ci_high', 'ci_upper', 'ci_hi', 'upper', 'hi', 'high', 'upper_bound', 'p97_5', 'p975']
  const find = (keys: string[]) => {
    for (const k of keys) {
      const v = extra[k]
      if (typeof v === 'number' && Number.isFinite(v)) return v
    }
    return null
  }
  const lo = find(lowKeys)
  const hi = find(highKeys)
  if (lo !== null && hi !== null) return [lo, hi]
  for (const k of ['ci', 'interval', 'ci_95']) {
    const v = extra[k]
    if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number')) return [v[0] as number, v[1] as number]
  }
  return null
}

function classify(r: MetricRow): Kind {
  const g = norm(r.group_name)
  if (/boot|interval|\bci\b/.test(g) || /boot|interval|\bci\b/.test(norm(r.metric_name))) return 'interval'
  if (/robust|blackspot def|\bn ?[235]\b/.test(g)) return 'robust'
  if (/split|second|backtest 2/.test(g)) return 'split'
  if (/low/.test(g) && /hist/.test(g)) return 'low'
  if (/overall|all cells/.test(g) || g === 'all') return 'overall'
  return 'other'
}

const diff = (r: MetricRow) =>
  r.model_value !== null && r.history_value !== null ? r.model_value - r.history_value : null

function signed(d: number | null): string {
  if (d === null) return '—'
  return `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(3)}`
}

function MetricTable({ rows, caption }: { rows: MetricRow[]; caption: string }) {
  return (
    <div className="sr-table-wrap">
      <table className="w-full min-w-[34rem] border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b-2 border-navy/20 text-sm uppercase tracking-wide text-navy/70">
            <th scope="col" className="py-2 pr-3">Group</th>
            <th scope="col" className="py-2 pr-3">Metric</th>
            <th scope="col" className="py-2 pr-3 text-right">History only</th>
            <th scope="col" className="py-2 pr-3 text-right">Model</th>
            <th scope="col" className="py-2 text-right">Model − history</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const d = diff(r)
            const tie = d !== null && Math.abs(d) < TIE_EPS
            return (
              <tr key={`${r.group_name}-${r.metric_name}-${i}`} className="border-b border-navy/10">
                <td className="py-2.5 pr-3 font-medium">{prettyFeature(r.group_name)}</td>
                <td className="py-2.5 pr-3">{prettyFeature(r.metric_name)}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums">{fmtNum(r.history_value)}</td>
                <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{fmtNum(r.model_value)}</td>
                <td className="py-2.5 text-right tabular-nums">
                  {signed(d)}
                  {tie && <span className="ml-2 rounded-full bg-navy/10 px-2 py-0.5 text-xs font-semibold">tie</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function IntervalTable({ rows }: { rows: MetricRow[] }) {
  return (
    <div className="sr-table-wrap">
      <table className="w-full min-w-[30rem] border-collapse text-left">
        <caption className="sr-only">Bootstrap intervals</caption>
        <thead>
          <tr className="border-b-2 border-navy/20 text-sm uppercase tracking-wide text-navy/70">
            <th scope="col" className="py-2 pr-3">Group</th>
            <th scope="col" className="py-2 pr-3">Metric</th>
            <th scope="col" className="py-2 pr-3 text-right">Value</th>
            <th scope="col" className="py-2 text-right">Interval</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const iv = readInterval(r.extra)
            const value = r.model_value ?? r.history_value
            return (
              <tr key={`${r.group_name}-${r.metric_name}-${i}`} className="border-b border-navy/10">
                <td className="py-2.5 pr-3 font-medium">{prettyFeature(r.group_name)}</td>
                <td className="py-2.5 pr-3">{prettyFeature(r.metric_name)}</td>
                <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{fmtNum(value)}</td>
                <td className="py-2.5 text-right tabular-nums">
                  {iv ? `${fmtNum(iv[0])} to ${fmtNum(iv[1])}` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function EvidencePage() {
  const q = useApi(api.metrics, [])
  const rows = useMemo(() => q.data ?? [], [q.data])

  const sections = useMemo(() => {
    const byKind = (k: Kind) => rows.filter((r) => classify(r) === k)
    return {
      overall: byKind('overall'),
      low: byKind('low'),
      robust: byKind('robust'),
      split: byKind('split'),
      intervals: rows.filter((r) => classify(r) === 'interval' || readInterval(r.extra) !== null),
    }
  }, [rows])

  const chartData = useMemo(
    () =>
      sections.low
        .filter((r) => r.model_value !== null && r.history_value !== null)
        .map((r) => ({
          metric: prettyFeature(r.metric_name),
          'History only': r.history_value,
          Model: r.model_value,
        })),
    [sections.low],
  )

  const overallComparable = sections.overall.filter((r) => diff(r) !== null)
  const overallTied = overallComparable.length > 0 && overallComparable.every((r) => Math.abs(diff(r) as number) < TIE_EPS)

  return (
    <PageContainer>
      <PageHeader eyebrow="Evidence" title="What the backtest shows">
        The model was trained on 2020–21 and tested on 2021–22, with no feature allowed to use data after its cut-off.
        This page compares it with a plain "history only" ranking, using the stored results.
      </PageHeader>

      {q.error && <ErrorBanner message={q.error} onRetry={q.reload} />}
      {q.loading && (
        <Card className="p-6">
          <SkeletonBlock lines={8} />
        </Card>
      )}
      {!q.loading && !q.error && rows.length === 0 && (
        <EmptyState title="No metrics in the database">Run the pipeline and load the database, then reload this page.</EmptyState>
      )}

      {rows.length > 0 && (
        <div className="space-y-8">
          <Card className="p-6">
            <h2 className="text-2xl font-bold">Overall result</h2>
            {sections.overall.length > 0 ? (
              <>
                <p className="mt-2 text-lg leading-relaxed">
                  {overallTied
                    ? 'Overall, the model and the history-only baseline tie. WAYMARK does not claim to beat history across all cells.'
                    : overallComparable.length > 0
                      ? 'Overall, the model and the history-only baseline score differently on at least one metric. The table shows each difference.'
                      : 'Overall results are listed below.'}
                </p>
                <p className="mb-4 mt-1 text-sm text-navy/65">Differences smaller than {TIE_EPS} are shown as a tie.</p>
                <MetricTable rows={sections.overall} caption="Overall results: history only versus model" />
              </>
            ) : (
              <p className="mt-2 text-navy/75">No rows labelled as overall results were found. See the full table below.</p>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="text-2xl font-bold">Low-history cells: history only vs model</h2>
            <p className="mt-2 max-w-3xl text-navy/80">
              Low-history cells have few recorded crashes, so a ranking based on past crashes has little to work with.
              This is where an explainable model could add something.
            </p>
            {chartData.length > 0 ? (
              <div className="mt-5 h-80" role="img" aria-label="Grouped bar chart comparing history-only and model results for low-history cells">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 16, bottom: 10, left: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#12203B22" />
                    <XAxis dataKey="metric" tick={{ fontSize: 13 }} interval={0} />
                    <YAxis tick={{ fontSize: 13 }} />
                    <Tooltip formatter={(v) => (typeof v === 'number' ? v.toFixed(3) : String(v))} />
                    <ChartLegend wrapperStyle={{ fontSize: 14 }} />
                    <Bar dataKey="History only" fill={MAP_PALETTE.amber} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Model" fill={MAP_PALETTE.teal} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-ivory-200 px-4 py-3 text-navy/75">
                No low-history rows with both values were found. See the full table below.
              </p>
            )}
            {sections.low.length > 0 && (
              <div className="mt-5">
                <MetricTable rows={sections.low} caption="Low-history results" />
              </div>
            )}
          </Card>

          {(sections.robust.length > 0 || sections.split.length > 0) && (
            <Card className="p-6">
              <h2 className="text-2xl font-bold">Robustness checks</h2>
              <p className="mb-4 mt-2 max-w-3xl text-navy/80">
                The same comparison under different blackspot definitions (N = 2, 3, 5) and on a second backtest split.
              </p>
              {sections.robust.length > 0 && (
                <>
                  <h3 className="mb-2 text-lg font-bold">Blackspot definition</h3>
                  <MetricTable rows={sections.robust} caption="Robustness to the blackspot definition" />
                </>
              )}
              {sections.split.length > 0 && (
                <>
                  <h3 className="mb-2 mt-6 text-lg font-bold">Second backtest split</h3>
                  <MetricTable rows={sections.split} caption="Second backtest split" />
                </>
              )}
            </Card>
          )}

          {sections.intervals.length > 0 && (
            <Card className="p-6">
              <h2 className="text-2xl font-bold">Bootstrap intervals</h2>
              <p className="mb-4 mt-2 max-w-3xl text-navy/80">
                Intervals show how much the result could move with a different sample of low-history cells.
              </p>
              <IntervalTable rows={sections.intervals} />
            </Card>
          )}

          <div role="note" className="rounded-[12px] border-2 border-brass bg-brass/10 p-6">
            <h2 className="text-2xl font-bold">One city, indicative, not proof</h2>
            <p className="mt-2 max-w-3xl text-lg leading-relaxed">
              These results come from Houston, TX and one main backtest. They suggest where a site audit may be worth
              considering. They do not prove that any location is unsafe, and they do not predict individual crashes.
              Human experts decide.
            </p>
          </div>

          <details className="rounded-[12px] border border-navy/15 bg-white p-4">
            <summary className="cursor-pointer text-lg font-semibold">All stored metric rows ({rows.length})</summary>
            <div className="mt-4">
              <MetricTable rows={rows} caption="All stored metric rows" />
            </div>
          </details>
        </div>
      )}
    </PageContainer>
  )
}
