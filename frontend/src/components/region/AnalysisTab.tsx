import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3, FileDown, Sparkles } from 'lucide-react'
import { ApiError } from '../../lib/api'
import { opsApi, saveBlob } from '../../lib/opsApi'
import type { RegionReport, ReportStatus, ReportSummary } from '../../lib/types.ops'
import { Card, ErrorBanner, SkeletonBlock } from '../ui'
import { PlaceholderNotice, SectionTitle } from '../ops/bits'
import { fmtDate } from '../ops/util'

const POLL_LIMIT_MS = 90_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Phase = 'idle' | 'working' | 'failed'

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-navy/10 bg-white p-4 shadow-sm transition hover:shadow-card">
      <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-navy/55">{label}</dt>
      <dd className="mt-1 font-serif text-3xl font-bold tracking-tight">{value}</dd>
      {sub && <p className="mt-1 text-xs leading-relaxed text-navy/60">{sub}</p>}
    </div>
  )
}

function ChartCard({
  title,
  summary,
  data,
  xKey,
  color,
}: {
  title: string
  summary: string
  data: Array<Record<string, number>>
  xKey: string
  color: string
}) {
  return (
    <Card className="rounded-2xl border-navy/10 p-4 shadow-sm sm:p-5">
      <h4 className="font-serif text-lg font-bold">{title}</h4>
      <figure aria-label={`${title}. ${summary}`} className="mt-2">
        <div className="h-56 w-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#12203b22" />
              <XAxis dataKey={xKey} tick={{ fontSize: 12 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="crashes" fill={color} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <figcaption className="sr-only">{summary}</figcaption>
      </figure>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-semibold text-teal">Show as a table</summary>
        <div className="sr-table-wrap mt-1 max-h-48 overflow-y-auto">
          <table className="w-full text-left">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col" className="pr-4">{xKey === 'year' ? 'Year' : 'Hour'}</th>
                <th scope="col">Crashes</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d[xKey]}>
                  <th scope="row" className="pr-4 font-normal">{d[xKey]}</th>
                  <td>{d.crashes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  )
}

export function AnalysisTab({
  kind,
  regionKey,
  onAsk,
  autoGenerate,
}: {
  kind: string
  regionKey: string
  onAsk: (report: RegionReport) => void
  /** Increase to ask this tab to generate a fresh report (used by the Progress tab's "Regenerate" prompt). */
  autoGenerate: number
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const [report, setReport] = useState<RegionReport | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [previous, setPrevious] = useState<ReportSummary[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [loadingFirst, setLoadingFirst] = useState(true)
  const run = useRef(0)
  const actionRef = useRef<HTMLDivElement>(null)
  const reportSectionRef = useRef<HTMLElement>(null)

  const reveal = useCallback((target: { current: HTMLElement | null }) => {
    requestAnimationFrame(() => target.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [])

  const refreshList = useCallback(async () => {
    try {
      setPrevious(await opsApi.listReports(kind, regionKey))
      setListError(null)
    } catch (e) {
      setListError(e instanceof ApiError ? e.message : 'Could not load the earlier reports.')
    }
  }, [kind, regionKey])

  const open = useCallback(async (id: string) => {
    const mine = ++run.current
    setPhase('working')
    setMessage('Opening the report…')
    setFailure(null)
    try {
      const r = await opsApi.getReport(id)
      if (mine !== run.current) return
      if (r.status === 'ready' && r.payload) {
        setReport(r.payload)
        setPhase('idle')
        setMessage('')
        reveal(reportSectionRef)
      } else {
        setPhase('failed')
        setFailure(r.error_safe ?? 'That report is not available.')
        reveal(actionRef)
      }
    } catch (e) {
      if (mine !== run.current) return
      setPhase('failed')
      setFailure(e instanceof ApiError ? e.message : 'Could not open that report.')
      reveal(actionRef)
    }
  }, [reveal])

  const generate = useCallback(async () => {
    const mine = ++run.current
    setPhase('working')
    setFailure(null)
    setMessage('Starting the analysis…')
    try {
      let status: ReportStatus = await opsApi.createReport(kind, regionKey)
      const started = Date.now()
      let delay = 500
      while (status.status === 'pending') {
        if (mine !== run.current) return
        if (Date.now() - started > POLL_LIMIT_MS) {
          setPhase('failed')
          setFailure('The report is taking longer than expected. Try again in a minute; if it keeps happening, ask an administrator to check the server.')
          return
        }
        setMessage(`Analysing the region… ${Math.round((Date.now() - started) / 1000)} s`)
        await sleep(delay)
        delay = Math.min(Math.round(delay * 1.5), 3000)
        status = await opsApi.getReport(status.report_id)
        if (status.payload) {
          setReport(status.payload)
          setMessage(status.status === 'pending' ? 'Analysis ready. Preparing the downloadable report…' : '')
        }
      }
      if (mine !== run.current) return
      if (status.status === 'ready' && status.payload) {
        setReport(status.payload)
        setPhase('idle')
        setMessage('')
      } else {
        if (status.payload) setReport(status.payload)
        setPhase('failed')
        setFailure(status.error_safe ?? 'The report could not be generated.')
      }
      void refreshList()
    } catch (e) {
      if (mine !== run.current) return
      setPhase('failed')
      setFailure(e instanceof ApiError ? e.message : 'The report could not be generated.')
    }
  }, [kind, regionKey, refreshList])

  // On first view, show the newest report that already exists for this region.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await opsApi.listReports(kind, regionKey)
        if (cancelled) return
        setPrevious(list)
        const newest = list.find((r) => r.status === 'ready')
        if (newest && autoGenerate === 0) await open(newest.report_id)
      } catch (e) {
        if (!cancelled) setListError(e instanceof ApiError ? e.message : 'Could not load the earlier reports.')
      } finally {
        if (!cancelled) setLoadingFirst(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [kind, regionKey, open, autoGenerate])

  const lastAuto = useRef(0)
  useEffect(() => {
    if (autoGenerate !== lastAuto.current) {
      lastAuto.current = autoGenerate
      void generate()
    }
  }, [autoGenerate, generate])

  const download = async (id: string, what: 'pdf' | 'json') => {
    setDownloadError(null)
    try {
      saveBlob(await opsApi.reportFile(id, what), `${id}.${what}`)
    } catch (e) {
      setDownloadError(e instanceof ApiError ? e.message : 'The download failed.')
    }
  }

  const a = report?.analysis
  const working = phase === 'working'
  const yearSummary = a?.year_trend.length
    ? `From ${a.year_trend[0].year} to ${a.year_trend[a.year_trend.length - 1].year}, the busiest year had ${Math.max(...a.year_trend.map((y) => y.crashes))} recorded crashes.`
    : 'No yearly crash counts.'
  const peak = a?.hour_of_day.length ? a.hour_of_day.reduce((m, h) => (h.crashes > m.crashes ? h : m)) : null

  return (
    <div className="space-y-7 pb-6">
      <div ref={actionRef} className="scroll-mt-24 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-navy via-navy to-[#263b60] px-4 py-3.5 text-ivory shadow-card sm:px-5 sm:py-4">
        <div className="flex items-start gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/15 bg-white/10 text-brass-soft"><BarChart3 aria-hidden="true" className="h-4 w-4" /></span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brass-soft">Regional safety intelligence</p>
            <h2 className="mt-0.5 font-serif text-xl font-bold sm:text-2xl">Area analysis</h2>
            <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-ivory/70 sm:text-sm">Hotspots, crash patterns, and priorities.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void generate()} disabled={working} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brass px-3.5 py-2 text-sm font-bold text-navy shadow-sm transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait disabled:opacity-60">
            <Sparkles aria-hidden="true" className="h-4 w-4" />{report ? 'Generate new report' : 'Generate report'}
          </button>
          <p role="status" aria-live="polite" className="min-h-5 w-full text-right text-xs font-medium text-ivory/70 sm:w-auto">{working ? message : ''}</p>
        </div>
      </div>

      {phase === 'failed' && failure && (
        <ErrorBanner message={failure} onRetry={() => void generate()} />
      )}
      {listError && <p className="text-sm text-brick">{listError}</p>}
      {loadingFirst && !report && <SkeletonBlock lines={5} />}

      {!report && !loadingFirst && phase !== 'working' && phase !== 'failed' && (
        <Card className="rounded-2xl border-dashed border-navy/20 bg-white/80 p-6 sm:p-8">
          <p className="font-serif text-2xl font-bold">Your regional analysis starts here</p>
          <p className="mt-2 max-w-2xl leading-relaxed text-navy/70">
            Generate one to see the headline index, the top hotspot cells, trends and priority issues. A PDF and a JSON
            file are produced too, and the assistant can read either.
          </p>
        </Card>
      )}

      {report && a && (
        <>
          <section ref={reportSectionRef} aria-labelledby="rep-head" className="scroll-mt-24 space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-navy/10 bg-white px-5 py-4 shadow-sm">
              <div>
                <SectionTitle id="rep-head">Report {report.report_id}</SectionTitle>
                <p className="mt-1 text-sm text-navy/60">Generated {fmtDate(report.generated_at)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={working} onClick={() => void download(report.report_id, 'pdf')} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-navy/15 bg-white px-3.5 py-2.5 text-sm font-bold transition hover:bg-ivory focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:cursor-wait disabled:opacity-50">
                  <FileDown aria-hidden="true" className="h-4 w-4" />PDF
                </button>
                <button type="button" disabled={working} onClick={() => void download(report.report_id, 'json')} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-navy/15 bg-white px-3.5 py-2.5 text-sm font-bold transition hover:bg-ivory focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:cursor-wait disabled:opacity-50">
                  JSON
                </button>
                <button type="button" disabled={working} onClick={() => onAsk(report)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy px-3.5 py-2.5 text-sm font-bold text-ivory transition hover:bg-navy-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:cursor-wait disabled:opacity-50">
                  <Sparkles aria-hidden="true" className="h-4 w-4" />Ask assistant
                </button>
              </div>
            </div>
            {downloadError && <p role="alert" className="text-sm font-semibold text-brick">{downloadError}</p>}
            <PlaceholderNotice show={report.placeholder_weights} />

            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Region risk index" value={a.risk_index === null ? '—' : a.risk_index.toFixed(1)} sub="out of 100 (mean of cell scores)" />
              <Stat label="Scored cells" value={a.region.cell_count.toLocaleString('en-US')} />
              <Stat label="Past crashes" value={a.total_crashes === null ? 'n/a' : a.total_crashes.toLocaleString('en-US')} sub={a.total_crashes === null ? 'crash records not loaded' : undefined} />
              <Stat label="Emerging-risk cells" value={a.emerging_cells.toLocaleString('en-US')} sub="elevated risk, little history" />
            </dl>
            {(a.incident_pending_count > 0 || a.incident_confirmed_count > 0) && (
              <p className="rounded-xl border border-teal/20 bg-teal/5 px-4 py-3 text-sm text-navy/80">
                Traffic Police reports: <strong>{a.incident_pending_count} pending</strong> and <strong>{a.incident_confirmed_count} confirmed</strong>.
                <span className="text-navy/60"> These are operational reports and do not change the historical crash score.</span>
              </p>
            )}
            {(a.night_share !== null || a.severe_share !== null) && (
              <p className="text-navy/80">
                {a.night_share !== null && <>Night-time crashes: <strong>{Math.round(a.night_share * 100)}%</strong>. </>}
                {a.severe_share !== null && <>Severity 3 or higher: <strong>{Math.round(a.severe_share * 100)}%</strong>.</>}
              </p>
            )}
          </section>

          <section aria-labelledby="hot-head" className="space-y-3">
            <SectionTitle id="hot-head">Top hotspot cells</SectionTitle>
            <Card className="sr-table-wrap rounded-2xl border-navy/10 shadow-sm">
              <table className="w-full min-w-[38rem] text-left text-sm">
                <caption className="sr-only">Highest-scoring cells in this region, best first</caption>
                <thead className="bg-navy text-xs uppercase tracking-wide text-ivory/80">
                  <tr>
                    <th scope="col" className="px-3 py-3">#</th>
                    <th scope="col" className="px-3 py-3">Cell</th>
                    <th scope="col" className="px-3 py-3">Score</th>
                    <th scope="col" className="px-3 py-3">Past crashes</th>
                    <th scope="col" className="px-3 py-3">Confidence</th>
                    <th scope="col" className="px-3 py-3">Locality</th>
                  </tr>
                </thead>
                <tbody>
                  {a.hotspots.map((h) => (
                    <tr key={h.cell_id} className="border-t border-navy/5 transition hover:bg-ivory/70">
                      <td className="px-3 py-3 text-navy/50">{h.rank}</td>
                      <th scope="row" className="px-3 py-3 font-mono font-semibold">
                        <Link to={`/map?cell=${encodeURIComponent(h.cell_id)}`} className="text-teal underline-offset-2 hover:underline">
                          {h.cell_id}
                        </Link>
                      </th>
                      <td className="px-3 py-2">{h.base_score === null ? '—' : h.base_score.toFixed(1)}</td>
                      <td className="px-3 py-2">{h.n_past_crashes.toLocaleString('en-US')}</td>
                      <td className="px-3 py-2">
                        {h.confidence ?? '—'}
                        {h.emerging_risk && <span className="ml-1 font-semibold text-brick"> · emerging</span>}
                      </td>
                      <td className="px-3 py-2">{h.locality ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>

          {a.year_trend.length > 0 || a.hour_of_day.length > 0 ? (
            <section aria-labelledby="chart-head" className="space-y-3">
              <SectionTitle id="chart-head">Trends</SectionTitle>
              <div className="grid gap-4 md:grid-cols-2">
                <ChartCard
                  title="Recorded crashes per year"
                  summary={yearSummary}
                  data={a.year_trend.map((y) => ({ year: y.year, crashes: y.crashes }))}
                  xKey="year"
                  color="#12203b"
                />
                <ChartCard
                  title="Recorded crashes by hour of day"
                  summary={peak ? `The busiest hour is ${peak.hour}:00 with ${peak.crashes} recorded crashes.` : 'No hourly counts.'}
                  data={a.hour_of_day.map((h) => ({ hour: h.hour, crashes: h.crashes }))}
                  xKey="hour"
                  color="#b8893b"
                />
              </div>
            </section>
          ) : (
            <p className="rounded-xl border border-navy/10 bg-white px-4 py-3 text-sm text-navy/70">Crash records are not loaded, so there are no trend charts for this region.</p>
          )}

          <section aria-labelledby="issue-head" className="space-y-3">
            <SectionTitle id="issue-head">Priority issues</SectionTitle>
            {a.priority_issues.length === 0 ? (
              <p className="rounded-xl border border-dashed border-navy/15 bg-white/70 px-4 py-5 text-sm text-navy/65">No priority issue met the thresholds for this region.</p>
            ) : (
              <ul className="space-y-3">
                {a.priority_issues.map((i) => (
                  <li key={i.id}>
                    <Card className="rounded-2xl border-navy/10 p-4 shadow-sm sm:p-5">
                      <h4 className="font-serif text-lg font-bold">{i.title}</h4>
                      {i.evidence.map((e) => (
                        <p key={e} className="mt-1 text-navy/85">{e}</p>
                      ))}
                      <p className="mt-3 border-t border-navy/5 pt-3 text-sm text-navy/65">
                        Cells:{' '}
                        {i.cell_ids.slice(0, 5).map((c, k) => (
                          <span key={c}>
                            {k > 0 && ', '}
                            <Link to={`/map?cell=${encodeURIComponent(c)}`} className="font-mono text-teal underline-offset-2 hover:underline">{c}</Link>
                          </span>
                        ))}
                        {i.cell_ids.length > 5 && ` and ${i.cell_ids.length - 5} more`}
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="cav-head" className="space-y-3">
            <SectionTitle id="cav-head">Caveats</SectionTitle>
            <ul className="rounded-2xl border border-amber/25 bg-amber/5 p-4 pl-9 text-sm leading-relaxed text-navy/80">
              {a.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="text-sm text-navy/70">{report.disclaimer}</p>
          </section>
        </>
      )}

      <section aria-labelledby="prev-head" className="space-y-2">
        <SectionTitle id="prev-head">Previous reports for this region</SectionTitle>
        {previous.length === 0 ? (
          <p className="text-navy/70">None yet.</p>
        ) : (
          <ul className="divide-y divide-navy/10 rounded-[12px] border border-navy/10 bg-white">
            {previous.map((r) => (
              <li key={r.report_id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="font-mono text-sm">{r.report_id}</span>
                <span className="text-sm text-navy/70">{fmtDate(r.created_at)}</span>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${r.status === 'ready' ? 'border-teal/50 text-teal' : r.status === 'failed' ? 'border-brick/50 text-brick' : 'border-navy/30'}`}>
                  {r.status === 'ready' ? '✓ ready' : r.status === 'failed' ? '✕ failed' : '… pending'}
                </span>
                {r.status === 'ready' && (
                  <span className="ml-auto flex gap-2">
                    <button type="button" onClick={() => void open(r.report_id)} aria-label={`Open report ${r.report_id}`} className="rounded-md border border-navy/25 px-3 py-1 text-sm font-semibold hover:bg-ivory-200">Open</button>
                    <button type="button" onClick={() => void download(r.report_id, 'pdf')} aria-label={`Download PDF for ${r.report_id}`} className="rounded-md border border-navy/25 px-3 py-1 text-sm font-semibold hover:bg-ivory-200">PDF</button>
                    <button type="button" onClick={() => void download(r.report_id, 'json')} aria-label={`Download JSON for ${r.report_id}`} className="rounded-md border border-navy/25 px-3 py-1 text-sm font-semibold hover:bg-ivory-200">JSON</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
