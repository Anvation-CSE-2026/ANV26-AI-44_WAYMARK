import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Progress } from '../../lib/types.ops'
import { Card } from '../ui'
import { EstimateNote, SectionTitle } from '../ops/bits'
import { fmtDate } from '../ops/util'

const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(2))

/** Base index -> adjusted index, the change, a trend of snapshots and the honesty notes. */
export function RiskPanel({ progress }: { progress: Progress }) {
  const { base_index: base, adjusted_index: adj, snapshots } = progress
  const projection = progress.projected_index ?? adj
  const change = base !== null && adj !== null ? adj - base : null
  const projectedChange = base !== null && projection !== null ? projection - base : null
  const data = snapshots.map((s, i) => ({ n: i + 1, base: s.base_index, adjusted: s.adjusted_index, when: fmtDate(s.created_at) }))
  const trendText =
    snapshots.length < 2
      ? 'Not enough history yet for a trend.'
      : `Across ${snapshots.length} snapshots the adjusted index went from ${snapshots[0].adjusted_index.toFixed(2)} to ${snapshots[snapshots.length - 1].adjusted_index.toFixed(2)}.`
  return (
    <Card className="overflow-hidden rounded-2xl border-navy/10">
      <div className="flex flex-wrap items-end justify-between gap-3 bg-navy px-5 py-4 text-ivory sm:px-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brass-soft">Regional overview</p>
          <SectionTitle>Risk scores</SectionTitle>
        </div>
        <p className="max-w-md text-xs leading-relaxed text-ivory/70">Baseline stays fixed. Confirmed reduction requires planner verification; projection follows work status.</p>
      </div>
      <div className="space-y-5 p-4 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-navy/10 bg-ivory/70 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-navy/55">Baseline index</p>
            <p className="mt-1 font-serif text-3xl font-bold text-navy">{fmt(base)}</p>
            <p className="mt-1 text-xs text-navy/55">Original mean cell score</p>
          </div>
          <div className="rounded-xl border border-teal/20 bg-teal/5 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-teal">Verified adjusted</p>
            <p className="mt-1 font-serif text-3xl font-bold text-teal">{fmt(adj)}</p>
            <p className="mt-1 text-xs text-navy/60">{change === null ? 'No comparison available' : `${change.toFixed(2)} vs baseline`}</p>
          </div>
          <div className="rounded-xl border border-brass/30 bg-brass/10 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-brass-700">Progress projection</p>
            <p className="mt-1 font-serif text-3xl font-bold text-navy">{fmt(projection)}</p>
            <p className="mt-1 text-xs text-navy/60">{projectedChange === null ? 'No comparison available' : `${projectedChange.toFixed(2)} vs baseline · estimate`}</p>
          </div>
        </div>
      {change === 0 && progress.verified_pct === 0 && (
        <p className="rounded-xl bg-ivory px-4 py-3 text-sm leading-relaxed text-navy/75">No verified measures yet, so the confirmed adjusted index equals baseline. The projection can move as work advances; only a planner’s approval changes confirmed adjusted risk.</p>
      )}
      {change === 0 && progress.verified_pct > 0 && (
        <p className="rounded-xl bg-ivory px-4 py-3 text-sm leading-relaxed text-navy/75">
          The verified measures so far have an effect weight of 0 (a site safety audit, for example, finds problems but does not
          itself reduce risk), so they do not lower the index. Measures such as lighting or junction changes do, once verified.
        </p>
      )}
      <p className="text-sm leading-relaxed text-navy/75">
        The projection applies the configured stage factor to each measure’s saved effect weight. Measures combine multiplicatively, with total credit capped at <strong>{Math.round(progress.credit_cap * 100)}%</strong>. This projection is an implementation estimate; it is not a model rerun or a verified safety outcome.
      </p>
      <EstimateNote />

      <figure aria-label={`Risk trend. ${trendText}`}>
        <p className="mb-2 text-sm font-bold text-navy">Confirmed risk history</p>
        <div className="h-52 w-full rounded-xl bg-ivory/70 p-2" aria-hidden="true">
          {data.length >= 2 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#12203b22" />
                <XAxis dataKey="n" tick={{ fontSize: 12 }} label={{ value: 'Snapshot', position: 'insideBottom', offset: -2, fontSize: 12 }} height={32} />
                <YAxis tick={{ fontSize: 12 }} domain={['auto', 'auto']} />
                <Tooltip />
                <Legend />
                <Line type="stepAfter" dataKey="base" name="Base" stroke="#8a93a6" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                <Line type="stepAfter" dataKey="adjusted" name="Adjusted" stroke="#2a7f8e" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="flex h-full items-center justify-center rounded-lg text-center text-sm text-navy/65">A trend line appears after the plan has changed a few times.</p>
          )}
        </div>
        <figcaption className="text-sm text-navy/70">{trendText}</figcaption>
      </figure>
      </div>
    </Card>
  )
}
