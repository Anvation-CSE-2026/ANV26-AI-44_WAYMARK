import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../lib/api'
import type { CheckStatus } from '../lib/api'
import { useApi } from '../hooks/useApi'
import { MAP_PALETTE, fmtInt, prettyFeature } from '../lib/format'
import { Card, EmptyState, ErrorBanner, PageContainer, PageHeader, SkeletonBlock, StatusBadge } from '../components/ui'

const ORDER: Record<CheckStatus, number> = { FAIL: 0, WARN: 1, PASS: 2 }
const FLAGGED: Record<number, string> = { 2017: '2017 jump', 2023: '2023 partial' }

export default function DataQualityPage() {
  const q = useApi(api.validation, [])
  const checks = useMemo(
    () => [...(q.data?.checks ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status]),
    [q.data],
  )
  const counts = useMemo(() => q.data?.counts ?? [], [q.data])

  const tally = useMemo(() => {
    const t: Record<CheckStatus, number> = { PASS: 0, WARN: 0, FAIL: 0 }
    for (const c of checks) t[c.status]++
    return t
  }, [checks])

  const yearly = useMemo(() => {
    const m = new Map<number, number>()
    for (const c of counts) m.set(c.year, (m.get(c.year) ?? 0) + c.crashes)
    return [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, crashes]) => ({ year: String(year), crashes, flag: FLAGGED[year] ?? '' }))
  }, [counts])

  const monthly = useMemo(
    () =>
      counts
        .filter((c) => c.month !== null)
        .sort((a, b) => a.year - b.year || (a.month as number) - (b.month as number))
        .map((c) => ({
          label: `${c.year}-${String(c.month).padStart(2, '0')}`,
          crashes: c.crashes,
        })),
    [counts],
  )

  return (
    <PageContainer>
      <PageHeader eyebrow="Data quality" title="Can we trust the data?">
        Every check run on the US Accidents dataset is listed here, including warnings. Nothing is hidden.
      </PageHeader>

      {q.error && <ErrorBanner message={q.error} onRetry={q.reload} />}
      {q.loading && (
        <Card className="p-6">
          <SkeletonBlock lines={8} />
        </Card>
      )}
      {!q.loading && !q.error && checks.length === 0 && counts.length === 0 && (
        <EmptyState title="No validation results yet">
          Run <code>pipeline/validate_data.py</code> and load the database, then reload this page.
        </EmptyState>
      )}

      {checks.length > 0 && (
        <section aria-labelledby="checks-h" className="mb-10">
          <h2 id="checks-h" className="sr-only">
            Validation checks
          </h2>
          <ul className="mb-5 flex flex-wrap gap-3" aria-label="Check totals">
            {(['PASS', 'WARN', 'FAIL'] as const).map((s) => (
              <li key={s} className="flex items-center gap-2 rounded-[12px] border border-navy/10 bg-white px-4 py-2 shadow-card">
                <StatusBadge status={s} />
                <span className="text-xl font-bold tabular-nums">{tally[s]}</span>
              </li>
            ))}
          </ul>
          <ul className="space-y-3">
            {checks.map((c, i) => (
              <li key={`${c.check_name}-${i}`}>
                <Card className="flex flex-col gap-2 p-4 md:flex-row md:items-start md:gap-5">
                  <div className="shrink-0 md:w-28">
                    <StatusBadge status={c.status} />
                  </div>
                  <div>
                    <h3 className="font-sans text-lg font-semibold">{prettyFeature(c.check_name)}</h3>
                    <p className="mt-0.5 leading-relaxed text-navy/80">{c.detail || 'No explanation recorded.'}</p>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {yearly.length > 0 && (
        <Card className="mb-8 p-6">
          <h2 className="text-2xl font-bold">Crashes per year, Houston</h2>
          <p className="mt-2 max-w-3xl text-navy/80">
            Amber bars mark two years that need care: 2017, where counts jump, and 2023, which is a partial year. See the
            matching checks above.
          </p>
          <div className="mt-5 h-80" role="img" aria-label="Bar chart of crashes per year in Houston, with 2017 and 2023 highlighted">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={yearly} margin={{ top: 28, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#12203B22" />
                <XAxis dataKey="year" tick={{ fontSize: 13 }} />
                <YAxis tick={{ fontSize: 13 }} tickFormatter={(v: number) => fmtInt(v)} />
                <Tooltip formatter={(v) => (typeof v === 'number' ? fmtInt(v) : String(v))} />
                <Bar dataKey="crashes" name="Crashes" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {yearly.map((d) => (
                    <Cell key={d.year} fill={d.flag ? MAP_PALETTE.amber : MAP_PALETTE.teal} />
                  ))}
                  <LabelList dataKey="flag" position="top" style={{ fontSize: 13, fontWeight: 600, fill: '#8A5410' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {monthly.length > 0 && (
        <Card className="p-6">
          <h2 className="text-2xl font-bold">Crashes per month</h2>
          <p className="mt-2 max-w-3xl text-navy/80">The monthly view shows where the data ends in 2023.</p>
          <div className="mt-5 h-72" role="img" aria-label="Line chart of crashes per month">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthly} margin={{ top: 10, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#12203B22" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} minTickGap={36} />
                <YAxis tick={{ fontSize: 13 }} tickFormatter={(v: number) => fmtInt(v)} />
                <Tooltip formatter={(v) => (typeof v === 'number' ? fmtInt(v) : String(v))} />
                <Line type="monotone" dataKey="crashes" name="Crashes" stroke={MAP_PALETTE.teal} strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </PageContainer>
  )
}
