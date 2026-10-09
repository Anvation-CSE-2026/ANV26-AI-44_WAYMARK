import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { BarChart3, ClipboardCheck, MapPin, Sparkles } from 'lucide-react'
import { SignIn } from '../components/AuthGate'
import { AnalysisTab } from '../components/region/AnalysisTab'
import { AssistantTab } from '../components/region/AssistantTab'
import { ProgressTab } from '../components/region/ProgressTab'
import { Toast } from '../components/ops/Toast'
import type { ToastData } from '../components/ops/Toast'
import { ErrorBanner, PageContainer, SkeletonBlock } from '../components/ui'
import { useAuth } from '../context/auth'
import { useApi } from '../hooks/useApi'
import { opsApi } from '../lib/opsApi'
import type { RegionReport } from '../lib/types.ops'

const TABS = [
  { id: 'analysis', label: 'Analysis', Icon: BarChart3 },
  { id: 'assistant', label: 'Assistant', Icon: Sparkles },
  { id: 'progress', label: 'Progress', Icon: ClipboardCheck },
] as const
type TabId = (typeof TABS)[number]['id']

export default function RegionPage() {
  const { regionId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { user } = useAuth()
  const autoGenerateRequested = useRef(params.get('generate') === '1')
  const kind = params.get('kind') || 'h3_parent'
  const key = regionId
  const requested = params.get('tab')
  const tab: TabId = TABS.some((t) => t.id === requested) ? (requested as TabId) : 'analysis'

  const regionQ = useApi((signal) => opsApi.resolveRegion(kind, key, signal), [kind, key])
  const region = regionQ.data

  // Panels stay mounted once opened, so a chat or an open drawer survives a trip to another tab.
  const [opened, setOpened] = useState<Set<TabId>>(() => new Set([tab]))
  const visited = opened.has(tab) ? opened : new Set(opened).add(tab)

  const [attachReport, setAttachReport] = useState<RegionReport | null>(null)
  const [progressNonce, setProgressNonce] = useState(0)
  const [regenNonce, setRegenNonce] = useState(() => autoGenerateRequested.current ? 1 : 0)
  const [toast, setToast] = useState<ToastData | null>(null)
  const toastId = useRef(0)

  useEffect(() => {
    if (!user || !autoGenerateRequested.current) return
    autoGenerateRequested.current = false
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('generate')
      return next
    }, { replace: true })
  }, [setParams, user])

  const goTab = useCallback(
    (id: TabId) => {
      setOpened((o) => new Set(o).add(id))
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          p.set('tab', id)
          return p
        },
        { replace: false },
      )
    },
    [setParams],
  )

  const notify = useCallback((message: ToastData['message'], actionLabel?: string, onAction?: () => void) => {
    setToast({ id: ++toastId.current, message, actionLabel, onAction })
  }, [])
  const closeToast = useCallback(() => setToast(null), [])

  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab)
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    if (next < 0) return
    e.preventDefault()
    goTab(TABS[next].id)
    tabRefs.current[TABS[next].id]?.focus()
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-[#f4f1eb]">
      <PageContainer className="flex max-w-7xl flex-1 flex-col py-6 md:py-9">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm">
          <Link to="/map" className="inline-flex items-center gap-2 rounded-full px-2 py-1 font-semibold text-brass-700 transition hover:bg-white/70 hover:underline">
            <span aria-hidden="true">←</span> Back to the map
          </Link>
        </nav>
        <header className="relative mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-navy via-navy to-[#263b60] px-5 py-6 text-ivory shadow-lift md:px-8 md:py-8">
          <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-20 h-64 w-64 rounded-full border border-white/10 bg-white/[0.03]" />
          <div className="relative flex items-start gap-4">
            <span className="mt-1 grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/15 bg-white/10 text-brass-soft"><MapPin aria-hidden="true" className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-brass-soft">Region workspace</p>
          {regionQ.loading && <SkeletonBlock lines={2} />}
          {regionQ.error && <ErrorBanner message={regionQ.error} onRetry={regionQ.reload} />}
          {region && (
            <>
              <h1 className="font-serif text-3xl font-bold leading-tight tracking-[-0.02em] md:text-4xl">{region.name}</h1>
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ivory/70 md:text-base">
                <span className="font-semibold text-ivory">{region.cell_count.toLocaleString('en-US')} scored cells</span>
                <span aria-hidden="true" className="text-brass">·</span> {region.kind}
                <span aria-hidden="true" className="text-brass">·</span> <span className="break-all font-mono text-xs">{region.key}</span>
              </p>
            </>
          )}
            </div>
          </div>
        </header>

        {!user ? (
          <SignIn />
        ) : (
          <>
          <div
            role="tablist"
            aria-label="Region sections"
            onKeyDown={onKeyDown}
            className="mb-6 flex w-full gap-1 overflow-x-auto rounded-2xl border border-navy/10 bg-white/70 p-1.5 shadow-sm sm:w-fit"
          >
            {TABS.map((t) => {
              const selected = t.id === tab
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabRefs.current[t.id] = el
                  }}
                  role="tab"
                  type="button"
                  id={`tab-${t.id}`}
                  aria-selected={selected}
                  aria-controls={`panel-${t.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => goTab(t.id)}
                  className={`inline-flex min-w-[7.5rem] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-bold transition sm:flex-none sm:text-base ${
                    selected ? 'bg-navy text-ivory shadow-sm' : 'text-navy/65 hover:bg-ivory hover:text-navy'
                  }`}
                >
                  <t.Icon aria-hidden="true" className="h-4 w-4" />
                  {t.label}
                </button>
              )
            })}
          </div>

          {TABS.map((t) => (
            <div
              key={t.id}
              role="tabpanel"
              id={`panel-${t.id}`}
              aria-labelledby={`tab-${t.id}`}
              hidden={t.id !== tab}
              tabIndex={0}
              className={`outline-none focus-visible:outline-brass ${t.id === tab ? 'flex flex-1 flex-col' : ''}`}
            >
              {visited.has(t.id) &&
                (t.id === 'analysis' ? (
                  <AnalysisTab
                    kind={kind}
                    regionKey={key}
                    autoGenerate={regenNonce}
                    onAsk={(report) => {
                      setAttachReport(report)
                      goTab('assistant')
                    }}
                  />
                ) : t.id === 'assistant' ? (
                  <AssistantTab
                    kind={kind}
                    regionKey={key}
                    attachReport={attachReport}
                    onAddedToPlan={(title) => {
                      setProgressNonce((n) => n + 1)
                      notify(`Added to the action plan: ${title}`, 'Open Progress tab', () => goTab('progress'))
                    }}
                  />
                ) : (
                  <ProgressTab
                    kind={kind}
                    regionKey={key}
                    reloadKey={progressNonce}
                    onRegenerate={() => {
                      setRegenNonce((n) => n + 1)
                      goTab('analysis')
                    }}
                    notify={notify}
                  />
                ))}
            </div>
          ))}
          </>
        )}

        <Toast toast={toast} onClose={closeToast} />
      </PageContainer>
    </div>
  )
}
