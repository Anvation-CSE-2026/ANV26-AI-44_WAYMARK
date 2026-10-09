import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { cellToParent, getResolution } from 'h3-js'
import { BarChart3, ClipboardCheck, Maximize2, Minimize2, MessageCircle, MapPin, Sparkles, X } from 'lucide-react'
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
import { ROLE_LABELS } from '../lib/types.ops'
import type { RegionReport } from '../lib/types.ops'

const TABS = [
  { id: 'analysis', label: 'Analysis', Icon: BarChart3 },
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
  const locationQ = useApi(
    (signal) => region ? opsApi.cellsInBounds(region.bounds, 1000, signal, true) : Promise.resolve([]),
    [region?.kind, region?.key, region?.bounds.south, region?.bounds.west, region?.bounds.north, region?.bounds.east],
  )
  const locationLabel = useMemo(() => {
    if (!region || !locationQ.data?.length) return null
    const counts = new Map<string, number>()
    for (const cell of locationQ.data) {
      if (region.kind === 'h3_parent') {
        try {
          if (cellToParent(cell.cell_id, getResolution(region.key)) !== region.key) continue
        } catch { continue }
      }
      const label = [cell.street_name, cell.locality].filter(Boolean).join(' · ')
      if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }, [locationQ.data, region])
  const regionHeading = region && (locationLabel ?? (region.kind === 'h3_parent' ? 'Area overview' : region.name))

  // Panels stay mounted once opened, so a chat or an open drawer survives a trip to another tab.
  const [opened, setOpened] = useState<Set<TabId>>(() => new Set([tab]))
  const visited = opened.has(tab) ? opened : new Set(opened).add(tab)

  const [attachReport, setAttachReport] = useState<RegionReport | null>(null)
  const [progressNonce, setProgressNonce] = useState(0)
  const [regenNonce, setRegenNonce] = useState(() => autoGenerateRequested.current ? 1 : 0)
  const [toast, setToast] = useState<ToastData | null>(null)
  const toastId = useRef(0)
  const [chatMounted, setChatMounted] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatExpanded, setChatExpanded] = useState(false)
  const assistantButtonRef = useRef<HTMLButtonElement>(null)
  const assistantDialogRef = useRef<HTMLDivElement>(null)
  const chatWasOpen = useRef(false)

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

  const openAssistant = useCallback((report?: RegionReport | null) => {
    if (report) setAttachReport(report)
    setChatMounted(true)
    setChatOpen(true)
  }, [])
  const closeAssistant = useCallback(() => {
    setChatOpen(false)
    setChatExpanded(false)
  }, [])

  useEffect(() => {
    if (chatOpen) {
      chatWasOpen.current = true
      requestAnimationFrame(() => assistantDialogRef.current?.focus({ preventScroll: true }))
    } else if (chatWasOpen.current) {
      chatWasOpen.current = false
      assistantButtonRef.current?.focus({ preventScroll: true })
    }
  }, [chatOpen, chatExpanded])

  const onAssistantKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeAssistant()
      return
    }
    if (!chatExpanded || e.key !== 'Tab') return
    const root = assistantDialogRef.current
    if (!root) return
    const focusable = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.offsetParent !== null)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

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
        <header className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-navy via-navy to-[#263b60] px-4 py-4 text-ivory shadow-lift sm:px-5 md:py-5">
          <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-20 h-52 w-52 rounded-full border border-white/10 bg-white/[0.03]" />
          <div className="relative flex items-start gap-3">
            <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/10 text-brass-soft"><MapPin aria-hidden="true" className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-brass-soft">Region workspace</p>
          {regionQ.loading && <SkeletonBlock lines={2} />}
          {regionQ.error && <ErrorBanner message={regionQ.error} onRetry={regionQ.reload} />}
          {region && (
            <>
              <h1 className="truncate font-serif text-2xl font-bold leading-tight tracking-[-0.02em] md:text-3xl" title={regionHeading ?? undefined}>{regionHeading}</h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ivory/70 sm:text-sm">
                <span className="font-semibold text-ivory">{region.cell_count.toLocaleString('en-US')} scored cells</span>
                <span aria-hidden="true" className="text-brass">·</span>
                <span>{region.kind === 'h3_parent' ? `H3 region · resolution ${getResolution(region.key)}` : region.kind}</span>
                <span aria-hidden="true" className="text-brass">·</span> <span className="break-all font-mono text-[11px]">{region.key}</span>
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
                    onAsk={(report) => openAssistant(report)}
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

        {user && (
          <>
            <button
              ref={assistantButtonRef}
              type="button"
              onClick={() => openAssistant()}
              aria-label="Open WAYMARK Assistant"
              aria-haspopup="dialog"
              aria-expanded={chatOpen}
              className={`fixed bottom-4 right-4 z-[1600] inline-flex h-14 w-14 items-center justify-center rounded-full bg-navy text-brass shadow-[0_8px_28px_rgba(18,32,59,0.3)] transition hover:scale-105 hover:bg-navy-800 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brass ${chatOpen ? 'invisible pointer-events-none' : ''}`}
            >
              <MessageCircle aria-hidden="true" className="h-6 w-6" />
            </button>

            {chatMounted && (
              <div
                ref={assistantDialogRef}
                role="dialog"
                aria-modal={chatExpanded || undefined}
                aria-label="WAYMARK Assistant"
                aria-hidden={!chatOpen}
                tabIndex={-1}
                onKeyDown={onAssistantKeyDown}
                onMouseDown={(e) => { if (chatExpanded && e.target === e.currentTarget) closeAssistant() }}
                className={`${chatOpen ? 'flex' : 'hidden'} fixed z-[1700] flex-col bg-navy/45 p-0 sm:p-4 ${chatExpanded ? 'inset-0 items-center justify-center' : 'inset-0 sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[min(44rem,calc(100dvh-2rem))] sm:w-[min(27rem,calc(100vw-2rem))]'}`}
              >
                <section className={`flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-white shadow-[0_16px_56px_rgba(18,32,59,0.3)] ${chatExpanded ? 'sm:h-[min(92dvh,58rem)] sm:max-w-6xl sm:rounded-2xl' : 'sm:rounded-2xl'}`}>
                  <header className="flex shrink-0 items-center justify-between gap-3 bg-navy px-4 py-3 text-ivory">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10 text-brass-soft"><Sparkles aria-hidden="true" className="h-4 w-4" /></span>
                      <div className="min-w-0">
                        <h2 className="truncate font-serif text-base font-bold">WAYMARK Assistant</h2>
                        <p className="truncate text-xs text-ivory/70">{user.role ? ROLE_LABELS[user.role] : 'Road safety insights'}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setChatExpanded((value) => !value)}
                        aria-label={chatExpanded ? 'Minimize Assistant window' : 'Expand Assistant window'}
                        title={chatExpanded ? 'Minimize' : 'Expand'}
                        className="grid h-10 w-10 place-items-center rounded-lg text-ivory/80 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
                      >
                        {chatExpanded ? <Minimize2 aria-hidden="true" className="h-5 w-5" /> : <Maximize2 aria-hidden="true" className="h-5 w-5" />}
                      </button>
                      <button
                        type="button"
                        onClick={closeAssistant}
                        aria-label="Minimize Assistant to its icon"
                        title="Minimize"
                        className="grid h-10 w-10 place-items-center rounded-lg text-ivory/80 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
                      >
                        <X aria-hidden="true" className="h-5 w-5" />
                      </button>
                    </div>
                  </header>
                  <AssistantTab
                    embedded
                    kind={kind}
                    regionKey={key}
                    attachReport={attachReport}
                    onAddedToPlan={(title) => {
                      setProgressNonce((n) => n + 1)
                      notify(`Added to the action plan: ${title}`, 'Open Progress tab', () => goTab('progress'))
                    }}
                  />
                </section>
              </div>
            )}
          </>
        )}

        <Toast toast={toast} onClose={closeToast} />
      </PageContainer>
    </div>
  )
}
