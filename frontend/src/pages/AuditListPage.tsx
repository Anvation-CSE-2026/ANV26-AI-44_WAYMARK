import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, auditCsvUrl } from '../lib/api'
import type { AuditRow, Confidence } from '../lib/api'
import { useApi } from '../hooks/useApi'
import { fmtInt, fmtNum, prettyFeature } from '../lib/format'
import { Card, ConfidenceBadge, EmptyState, ErrorBanner, PageHeader, SkeletonBlock } from '../components/ui'

type SortKey = 'rank' | 'region' | 'locality' | 'cell_id' | 'history_percentile' | 'n_past_crashes' | 'risk_score' | 'confidence'

const PAGE_SIZE = 50
const CONF_ORDER: Record<Confidence, number> = { High: 3, Medium: 2, Low: 1 }

function sortValue(r: AuditRow, k: SortKey): number | string {
  switch (k) {
    case 'cell_id':
      return r.cell_id
    case 'region':
      return r.region
    case 'locality':
      return r.locality ?? ''
    case 'history_percentile':
      return r.history_percentile ?? -1
    case 'confidence':
      return CONF_ORDER[r.confidence]
    default:
      return r[k]
  }
}

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'rank', label: 'Rank', numeric: true },
  { key: 'region', label: 'Region' },
  { key: 'locality', label: 'Locality' },
  { key: 'cell_id', label: 'Cell ID' },
  { key: 'history_percentile', label: 'Riskier than (similar history)', numeric: true },
  { key: 'n_past_crashes', label: 'Past crashes', numeric: true },
  { key: 'confidence', label: 'Confidence' },
  { key: 'risk_score', label: 'Risk score', numeric: true },
]

export default function AuditListPage() {
  const q = useApi(api.auditList, [])
  const rows = useMemo(() => q.data ?? [], [q.data])
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('rank')
  const [asc, setAsc] = useState(true)
  const [page, setPage] = useState(0)

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    const list = term
      ? rows.filter((r) => r.region.toLowerCase().includes(term) || r.locality?.toLowerCase().includes(term) || r.cell_id.toLowerCase().includes(term) || r.top_factors.join(' ').toLowerCase().includes(term))
      : rows
    return [...list].sort((a, b) => {
      const av = sortValue(a, sortKey)
      const bv = sortValue(b, sortKey)
      const c = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv) : (av as number) - (bv as number)
      return asc ? c : -c
    })
  }, [rows, search, sortKey, asc])

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage = Math.min(page, pages - 1)
  const slice = visible.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setAsc((a) => !a)
    else {
      setSortKey(k)
      setAsc(k === 'rank' || k === 'cell_id' || k === 'region')
    }
    setPage(0)
  }

  return (
    <div className="mx-auto w-full max-w-[96rem] px-4 py-10 md:py-14">
      <PageHeader eyebrow="Audit list" title="Cells to consider for a site audit">
        Emerging-risk cells, sorted by the order stored in the database. Each is a candidate for a human-led site audit,
        not a finding.
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="audit-search" className="block text-sm font-semibold">
            Search by region, cell ID or factor
          </label>
          <input
            id="audit-search"
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            placeholder="e.g. Harris or night"
            className="mt-1 w-full rounded-lg border border-navy/25 bg-white px-3 py-2.5"
          />
        </div>
        <a
          href={auditCsvUrl()}
          download="waymark-audit-list.csv"
          className="rounded-lg bg-brass px-4 py-2.5 font-semibold text-navy hover:bg-brass/85"
        >
          Download CSV
        </a>
      </div>

      {q.error && <ErrorBanner message={q.error} onRetry={q.reload} />}
      {q.loading && (
        <Card className="p-6">
          <SkeletonBlock lines={10} />
        </Card>
      )}
      {!q.loading && !q.error && rows.length === 0 && (
        <EmptyState title="No emerging-risk cells on the list">
          Nothing is flagged in the database right now.
        </EmptyState>
      )}
      {!q.loading && rows.length > 0 && visible.length === 0 && (
        <EmptyState title="No cells match your search">Try a shorter cell ID or a different factor.</EmptyState>
      )}

      {slice.length > 0 && (
        <Card className="overflow-hidden">
          <div className="sr-table-wrap">
            <table className="w-full min-w-[80rem] border-collapse text-left">
              <caption className="sr-only">Emerging-risk cells recommended for a site audit</caption>
              <thead className="bg-ivory-200/70">
                <tr className="text-sm uppercase tracking-wide text-navy/70">
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={sortKey === c.key ? (asc ? 'ascending' : 'descending') : 'none'}
                      className={`whitespace-nowrap px-3 py-3 ${c.numeric ? 'text-right' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className="inline-flex items-center gap-1 whitespace-nowrap font-semibold uppercase tracking-wide hover:text-navy"
                      >
                        {c.label}
                        <span aria-hidden="true" className={sortKey === c.key ? 'text-brass-700' : 'text-navy/30'}>
                          {sortKey === c.key ? (asc ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th scope="col" className="whitespace-nowrap px-3 py-3">Top factors</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3">Open</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((r) => (
                  <tr key={r.cell_id} className="border-t border-navy/10 align-top hover:bg-ivory-200/40">
                    <td className="px-3 py-3 text-right tabular-nums">{fmtInt(r.rank)}</td>
                    <td className="px-3 py-3">{r.region}</td>
                    <td className="px-3 py-3">{r.locality || '—'}</td>
                    <td className="px-3 py-3 font-mono text-sm">{r.cell_id}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {r.history_percentile === null ? '—' : `${Math.round(r.history_percentile)}%`}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtInt(r.n_past_crashes)}</td>
                    <td className="px-3 py-3">
                      <ConfidenceBadge value={r.confidence} />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtNum(r.risk_score, 3)}</td>
                    <td className="max-w-[16rem] px-3 py-3 text-sm text-navy/85">
                      {r.top_factors.length ? r.top_factors.map(prettyFeature).join(', ') : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-sm">
                      <Link to={`/map?cell=${encodeURIComponent(r.cell_id)}`} className="font-semibold text-teal underline underline-offset-2">
                        View on map
                      </Link>
                      <span aria-hidden="true"> · </span>
                      <a
                        href={`https://www.google.com/maps?q=${r.lat},${r.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-teal underline underline-offset-2"
                      >
                        Google Maps<span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-navy/10 px-4 py-3 text-sm">
            <p aria-live="polite">
              Showing {fmtInt(safePage * PAGE_SIZE + 1)}–{fmtInt(Math.min(visible.length, (safePage + 1) * PAGE_SIZE))} of{' '}
              {fmtInt(visible.length)} cells
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage(safePage - 1)}
                disabled={safePage === 0}
                className="rounded-lg border border-navy/25 px-3 py-1.5 font-semibold hover:bg-ivory-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage(safePage + 1)}
                disabled={safePage >= pages - 1}
                className="rounded-lg border border-navy/25 px-3 py-1.5 font-semibold hover:bg-ivory-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
