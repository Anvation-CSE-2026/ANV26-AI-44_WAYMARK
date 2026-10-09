import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Progress } from '../../lib/types.ops'
import { Card } from '../ui'
import { EstimateNote, SectionTitle } from '../ops/bits'
import { fmtDate } from '../ops/util'

const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(2))

/** Base index -> adjusted index, the change, a trend of snapshots and the honesty notes. */
export function RiskPanel({ progress }: { progress: Progress }) {
  const { base_index: base, adjusted_index: adj, snapshots } = progress
  const change = base !== null && adj !== null ? adj - base : null
  const data = snapshots.map((s, i) => ({ n: i + 1, base: s.base_index, adjusted: s.adjusted_index, when: fmtDate(s.created_at) }))
  const trendText =
    snapshots.length < 2
      ? 'Not enough history yet for a trend.'
      : `Across ${snapshots.length} snapshots the adjusted index went from ${snapshots[0].adjusted_index.toFixed(2)} to ${snapshots[snapshots.length - 1].adjusted_index.toFixed(2)}.`
  return (
    <Card className="space-y-4 p-5">
      <SectionTitle>Risk estimate for this region</SectionTitle>
      <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr_1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-navy/60">Base index</p>
          <p className="font-serif text-4xl font-bold">{fmt(base)}</p>
        </div>
        <span aria-hidden="true" className="hidden text-3xl text-navy/40 sm:block">→</span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-navy/60">Adjusted index (estimate)</p>
          <p className="font-serif text-4xl font-bold text-teal">{fmt(adj)}</p>
        </div>
        <div aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-wide text-navy/60">Change</p>
          <p className="font-serif text-3xl font-bold">
            {change === null ? '—' : change === 0 ? '0.00' : `${change < 0 ? '▼ ' : '▲ '}${Math.abs(change).toFixed(2)}`}
          </p>
          <p className="text-sm text-navy/65">{change === null || change === 0 ? 'no change yet' : change < 0 ? 'lower than base' : 'higher than base'}</p>
        </div>
      </div>
      {change === 0 && progress.verified_pct === 0 && (
        <p className="text-navy/80">No verified measures yet, so the adjusted index equals the base index. Uploading photos does not change it; only a planner's approval does.</p>
      )}
      {change === 0 && progress.verified_pct > 0 && (
        <p className="text-navy/80">
          The verified measures so far have an effect weight of 0 (a site safety audit, for example, finds problems but does not
          itself reduce risk), so they do not lower the index. Measures such as lighting or junction changes do, once verified.
        </p>
      )}
      <p className="text-navy/85">
        Each verified measure lowers the scores of its cells by its effect weight. Several measures on one cell combine
        multiplicatively, and the total credit on a cell is capped at <strong>{Math.round(progress.credit_cap * 100)}%</strong>.
      </p>
      <EstimateNote />

      <figure aria-label={`Risk trend. ${trendText}`}>
        <div className="h-52 w-full" aria-hidden="true">
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
            <p className="flex h-full items-center justify-center rounded-lg bg-ivory-200/60 text-navy/65">A trend line appears once the plan has changed a few times.</p>
          )}
        </div>
        <figcaption className="text-sm text-navy/70">{trendText}</figcaption>
      </figure>
    </Card>
  )
}
