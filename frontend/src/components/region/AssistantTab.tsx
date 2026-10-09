import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link } from 'react-router-dom'
import { Check, FileText, MapPin, Paperclip, RotateCw, Send, ShieldCheck, Sparkles, Square } from 'lucide-react'
import { ApiError } from '../../lib/api'
import { opsApi } from '../../lib/opsApi'
import { ROLE_LABELS } from '../../lib/types.ops'
import type { ChatEvent, ChatSession, RecommendationCard, RegionReport, ReportChip, RoleId } from '../../lib/types.ops'
import { Card } from '../ui'
import { useAuth } from '../../context/auth'
import { categoryLabel, fmtDate, useEffects } from '../ops/util'

const ROLE_INFO: Record<RoleId, { starters: string[] }> = {
  planner: {
    starters: ['What should we do first?', 'Which cells should be audited before anything else?', 'What evidence should I ask for before approving a measure?'],
  },
  engineer: {
    starters: ['What should we inspect on site first?', 'Which measures can we deliver at the top hotspots?', 'What photos should I take as evidence?'],
  },
  community: {
    starters: ['Which hotspots need traffic safety attention first?', 'What should officers document during a site visit?', 'What should Traffic Police coordinate with City Planners?'],
  },
}

interface UiMessage {
  key: string
  author: 'user' | 'assistant'
  content: string
  cards: RecommendationCard[]
  fallback: boolean
  streaming: boolean
  note?: string
  question?: string
}

type CardState = { state: 'idle' | 'adding' | 'added' | 'dismissed'; error?: string }

function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      skipHtml
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-teal underline decoration-teal/40 underline-offset-4 hover:decoration-teal">
            {children}
          </a>
        ),
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
        code: ({ children }) => <code className="rounded-md bg-navy/10 px-1.5 py-0.5 font-mono text-[0.9em]">{children}</code>,
      }}
    >
      {text}
    </ReactMarkdown>
  )
}

export function AssistantTab({
  kind,
  regionKey,
  attachReport,
  onAddedToPlan,
}: {
  kind: string
  regionKey: string
  attachReport: RegionReport | null
  onAddedToPlan: (title: string) => void
}) {
  const { user } = useAuth()
  const fx = useEffects()
  const [session, setSession] = useState<ChatSession | null>(null)
  const [chip, setChip] = useState<ReportChip | null>(null)
  const [attachNote, setAttachNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [cards, setCards] = useState<Record<string, CardState>>({})
  const abortRef = useRef<AbortController | null>(null)
  const seq = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const lastAuto = useRef<string>('')
  const identityRef = useRef<string>('')

  const role = session?.role ?? user?.role ?? null
  const anyFallback = msgs.some((m) => m.fallback)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [msgs])

  const startSession = useCallback(async (r: RoleId) => {
    abortRef.current?.abort()
    setCreating(true)
    setCreateError(null)
    try {
      const s = await opsApi.createSession(r)
      setSession(s)
      setChip(s.report)
      setMsgs([])
      setCards({})
      setAttachNote(null)
      lastAuto.current = ''
    } catch (e) {
      setCreateError(e instanceof ApiError ? e.message : 'Could not start a chat. Please try again.')
    } finally {
      setCreating(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    const identity = `${user.id}:${user.role}`
    if (identityRef.current === identity) return
    identityRef.current = identity
    abortRef.current?.abort()
    setSession(null)
    setMsgs([])
    setCards({})
    void startSession(user.role)
  }, [user?.id, user?.role, startSession])

  const attachFile = useCallback(
    async (file: Blob, name: string) => {
      if (!session) return
      setAttaching(true)
      setAttachNote(null)
      try {
        const c = await opsApi.attachReport(session.session_id, file, name)
        setChip(c)
        setAttachNote({ ok: true, text: `Attached ${c.report_id}.` })
      } catch (e) {
        setAttachNote({ ok: false, text: e instanceof ApiError ? e.message : 'That file could not be attached.' })
      } finally {
        setAttaching(false)
      }
    },
    [session],
  )

  // Hand-off from the Analysis tab: attach the report that was open there.
  useEffect(() => {
    if (!session || !attachReport) return
    const id = `${session.session_id}:${attachReport.report_id}`
    if (lastAuto.current === id || chip?.report_id === attachReport.report_id) return
    lastAuto.current = id
    ;(async () => {
      let blob: Blob
      try {
        blob = await opsApi.reportFile(attachReport.report_id, 'json')
      } catch {
        blob = new Blob([JSON.stringify(attachReport)], { type: 'application/json' })
      }
      await attachFile(blob, `${attachReport.report_id}.json`)
    })()
  }, [session, attachReport, chip, attachFile])

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) void attachFile(f, f.name)
  }

  const latest = async () => {
    if (!session) return
    try {
      setChip(await opsApi.useLatestReport(session.session_id))
      setAttachNote({ ok: true, text: 'Now using the latest report.' })
    } catch (e) {
      setAttachNote({ ok: false, text: e instanceof ApiError ? e.message : 'Could not switch to the latest report.' })
    }
  }

  const patch = (key: string, fn: (m: UiMessage) => UiMessage) => setMsgs((all) => all.map((m) => (m.key === key ? fn(m) : m)))

  const send = async (text: string) => {
    const q = text.trim()
    if (!session || !q || busy) return
    const aKey = `a${++seq.current}`
    setMsgs((all) => [
      ...all,
      { key: `u${++seq.current}`, author: 'user', content: q, cards: [], fallback: false, streaming: false },
      { key: aKey, author: 'assistant', content: '', cards: [], fallback: false, streaming: true, question: q },
    ])
    setInput('')
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy(true)
    const onEvent = (ev: ChatEvent) => {
      if (ev.type === 'token') patch(aKey, (m) => ({ ...m, content: m.content + ev.text }))
      else if (ev.type === 'card') patch(aKey, (m) => ({ ...m, cards: [...m.cards, ev.card] }))
      else if (ev.type === 'done') patch(aKey, (m) => ({ ...m, fallback: ev.fallback_mode, streaming: false }))
      else if (ev.type === 'error') patch(aKey, (m) => ({ ...m, note: ev.message, streaming: false }))
    }
    try {
      await opsApi.sendMessage(session.session_id, q, onEvent, ctrl.signal)
    } catch (e) {
      const stopped = e instanceof DOMException && e.name === 'AbortError'
      patch(aKey, (m) => ({
        ...m,
        note: stopped ? 'Stopped.' : e instanceof ApiError ? e.message : 'The assistant could not answer. Please try again.',
      }))
    } finally {
      patch(aKey, (m) => ({ ...m, streaming: false }))
      setBusy(false)
      abortRef.current = null
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void send(input)
  }

  const setCard = (id: string, s: CardState) => setCards((c) => ({ ...c, [id]: s }))

  const addToPlan = async (card: RecommendationCard) => {
    if (!chip) return
    if (user?.role === 'community' || (user?.role === 'engineer' && card.owner_role !== 'engineer')) return
    setCard(card.card_id, { state: 'adding' })
    try {
      await opsApi.createMeasure({
        region_kind: chip.region.kind,
        region_key: chip.region.key,
        title: card.title,
        category: card.category,
        cell_ids: card.cell_ids,
        report_id: chip.report_id,
        description: card.rationale,
        owner_role: card.owner_role,
        source: 'chat',
      })
      setCard(card.card_id, { state: 'added' })
      onAddedToPlan(card.title)
    } catch (e) {
      setCard(card.card_id, { state: 'idle', error: e instanceof ApiError ? e.message : 'Could not add this to the plan.' })
    }
  }

  const otherRegion = chip && (chip.region.kind !== kind || chip.region.key !== regionKey)

  // ------------------------------------------------------------------ session startup
  if (!session) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center py-6 sm:py-10">
        <div className="mb-7 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-navy text-brass shadow-card"><Sparkles aria-hidden="true" className="h-6 w-6" /></span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brass-700">WAYMARK assistant</p>
            <h2 className="font-serif text-3xl font-bold tracking-tight sm:text-4xl">How can I help?</h2>
          </div>
        </div>
        <p className="mb-6 max-w-2xl leading-relaxed text-navy/70">Preparing your workspace{role ? ` for ${ROLE_LABELS[role]}` : ''}.</p>
        {attachReport && (
          <p role="note" className="mb-5 flex items-center gap-2 rounded-xl border border-brass/30 bg-brass/10 px-4 py-3 text-sm font-semibold text-navy">
            <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-brass-700" />
            Report {attachReport.report_id} will be attached when you start.
          </p>
        )}
        {creating && <p role="status" className="rounded-xl border border-navy/10 bg-white px-4 py-4 font-medium text-navy/75 shadow-card">Starting your chat…</p>}
        {createError && <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-brick/25 bg-brick/5 px-4 py-3 font-semibold text-brick"><p role="alert">{createError}</p><button type="button" onClick={() => user && void startSession(user.role)} className="min-h-10 rounded-lg bg-navy px-4 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass">Try again</button></div>}
      </div>
    )
  }

  return (
    <div className="flex min-h-[32rem] flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-navy px-4 py-4 text-ivory shadow-card sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 text-brass-soft ring-1 ring-white/15"><Sparkles aria-hidden="true" className="h-5 w-5" /></span>
          <div>
            <h2 className="font-serif text-xl font-bold sm:text-2xl">WAYMARK assistant</h2>
            <p className="mt-0.5 text-xs text-ivory/65 sm:text-sm">Road safety insights for your region</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-ivory sm:text-sm">{role && ROLE_LABELS[role]}</span>
        </div>
      </div>

      {anyFallback && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-amber/50 bg-amber/10 px-4 py-3 text-sm font-semibold text-[#6b4210]">
          <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full bg-amber/20">!</span>
          AI assistant unavailable; showing rule-based suggestions
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={onDrop}
        className={`relative flex min-h-[30rem] flex-1 flex-col rounded-2xl transition-shadow ${dragging ? 'ring-2 ring-brass ring-offset-2' : ''}`}
      >
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border-navy/10 shadow-card">
          <div className="border-b border-navy/10 bg-white px-4 py-4 sm:px-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {chip ? (
                <>
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-teal/10 text-teal"><FileText aria-hidden="true" className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold">{chip.report_id}</span>
                      <span className="rounded-full bg-teal/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-teal">Report attached</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-navy/60 sm:text-sm">
                      <span className="inline-flex items-center gap-1"><MapPin aria-hidden="true" className="h-3.5 w-3.5" />{chip.region.name}</span>
                      <span>Generated {fmtDate(chip.generated_at)}</span>
                    </div>
                  </div>
                  {attaching && <span role="status" className="text-xs font-semibold text-teal">Attaching…</span>}
                </>
              ) : (
                <>
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-ivory text-navy/70"><FileText aria-hidden="true" className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">Add a Region Report</p>
                    <p className="mt-0.5 text-xs text-navy/60 sm:text-sm">Attach a PDF or JSON for report-specific answers and recommendations.</p>
                  </div>
                  {attaching && <span role="status" className="text-xs font-semibold text-teal">Attaching…</span>}
                </>
              )}
            </div>
            {chip?.stale && (
              <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber/40 bg-amber/10 px-3 py-2.5 text-sm text-[#6b4210]">
                <span aria-hidden="true">⚠</span>
                <span className="min-w-0 flex-1">Out of date: {chip.stale_reason}</span>
                <button type="button" onClick={() => void latest()} className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-2 text-xs font-bold text-white transition hover:bg-navy-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass">
                  <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />Use latest report
                </button>
              </div>
            )}
            {otherRegion && chip && (
              <p className="mt-3 rounded-lg bg-ivory px-3 py-2 text-sm text-navy/75">
                This report is for another region. Measures go to{' '}
                <Link className="font-semibold text-teal underline decoration-teal/40 underline-offset-4" to={`/region/${encodeURIComponent(chip.region.key)}?kind=${encodeURIComponent(chip.region.kind)}&tab=progress`}>
                  {chip.region.name}
                </Link>.
              </p>
            )}
            {attachNote && <p role={attachNote.ok ? 'status' : 'alert'} className={`mt-2 text-sm font-semibold ${attachNote.ok ? 'text-teal' : 'text-brick'}`}>{attachNote.text}</p>}
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col bg-[#f8f6f1]">
            {dragging && <p className="absolute inset-x-4 top-4 z-10 rounded-xl border border-dashed border-brass bg-white/95 px-4 py-3 text-center text-sm font-bold text-navy shadow-card">Drop the report here to attach it</p>}
            <div ref={listRef} aria-live="polite" aria-label="Conversation" role="log" className="min-h-[18rem] flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
              {msgs.length === 0 && (
                <div className="mx-auto flex min-h-[17rem] max-w-3xl flex-col justify-center py-5">
                  <div className="mb-5 flex items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-navy text-brass-soft"><Sparkles aria-hidden="true" className="h-4 w-4" /></span>
                    <div className="max-w-2xl rounded-2xl rounded-tl-sm border border-navy/5 bg-white px-4 py-3.5 shadow-sm">
                      <p className="font-semibold">Start with a question about road safety in this region.</p>
                      <p className="mt-1 text-sm leading-relaxed text-navy/65">{chip ? 'I can help interpret the attached report and turn findings into next steps.' : 'Attach a Region Report for tailored recommendations, or ask a general question to get started.'}</p>
                    </div>
                  </div>
                  <p className="mb-2 pl-12 text-xs font-bold uppercase tracking-[0.14em] text-navy/45">Suggested questions</p>
                  <div className="flex flex-wrap gap-2 pl-12">
                    {role && ROLE_INFO[role].starters.map((s) => (
                      <button key={s} type="button" disabled={busy} onClick={() => void send(s)} className="rounded-full border border-navy/15 bg-white px-3.5 py-2 text-left text-xs font-semibold text-navy/80 shadow-sm transition hover:border-brass/60 hover:bg-brass/5 hover:text-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:opacity-50 sm:text-sm">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((m) => (
                <div key={m.key} className={`flex gap-3 ${m.author === 'user' ? 'justify-end' : 'items-start'}`}>
                  {m.author === 'assistant' && <span aria-hidden="true" className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-navy text-brass-soft"><Sparkles className="h-4 w-4" /></span>}
                  <div className={`min-w-0 max-w-[min(90%,48rem)] rounded-2xl px-4 py-3.5 shadow-sm sm:px-5 ${m.author === 'user' ? 'rounded-br-md bg-navy text-ivory' : 'rounded-tl-md border border-navy/5 bg-white text-navy'}`}>
                    <p className="sr-only">{m.author === 'user' ? 'You said' : 'Assistant said'}</p>
                    {m.author === 'assistant' && m.content === '' && m.streaming ? (
                      <p className="flex items-center gap-2 text-sm text-navy/65"><span className="h-2 w-2 animate-pulse rounded-full bg-teal motion-reduce:animate-none" />Thinking through the details…</p>
                    ) : m.author === 'assistant' ? (
                      <Markdown text={m.content} />
                    ) : (
                      <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                    )}
                    {m.note && (
                      <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-brick/5 px-3 py-2 text-sm font-semibold text-brick">
                        {m.note}
                        {m.question && !busy && <button type="button" onClick={() => void send(m.question ?? '')} className="rounded-lg border border-brick/25 bg-white px-2.5 py-1 text-xs font-bold text-brick transition hover:bg-brick/10">Retry</button>}
                      </p>
                    )}
                    {m.cards.length > 0 && (
                      <section className="mt-5" aria-label="Recommended actions">
                        <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-brass-700"><ShieldCheck aria-hidden="true" className="h-4 w-4" />Recommended actions</div>
                        <p className="mb-3 text-sm text-navy/65">Review a recommendation, then add it to the regional action plan.</p>
                        <ul className="space-y-3">
                          {m.cards.map((c) => {
                            const st = cards[c.card_id] ?? { state: 'idle' as const }
                            if (st.state === 'dismissed') return null
                            return (
                              <li key={c.card_id}>
                                <article aria-label={`Recommendation: ${c.title}`} className="overflow-hidden rounded-xl border border-navy/10 bg-white shadow-sm">
                                  <div className="border-b border-navy/5 bg-ivory/70 px-4 py-3">
                                    <h4 className="font-bold leading-snug">{c.title}</h4>
                                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                      <span className="rounded-full bg-navy/5 px-2.5 py-1 font-semibold">{categoryLabel(fx, c.category)}</span>
                                      <span className="rounded-full bg-teal/10 px-2.5 py-1 font-semibold text-teal">Owner: {ROLE_LABELS[c.owner_role]}</span>
                                      {c.evidence_needed.length > 0 && <span className="rounded-full bg-brass/15 px-2.5 py-1 font-semibold text-brass-700">{c.evidence_needed.join(' + ')} photos</span>}
                                    </div>
                                  </div>
                                  <div className="px-4 py-3.5">
                                    <p className="text-sm leading-relaxed text-navy/80">{c.rationale}</p>
                                    <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-navy/60">
                                      <span className="font-bold uppercase tracking-wide">Cells</span>
                                      {c.cell_ids.map((id, i) => <span key={id}>{i > 0 && <span className="mr-2 text-navy/30">·</span>}<Link to={`/map?cell=${encodeURIComponent(id)}`} className="font-mono font-semibold text-teal underline decoration-teal/30 underline-offset-4 hover:decoration-teal">{id}</Link></span>)}
                                    </p>
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                      {st.state === 'added' ? (
                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-teal/10 px-3 py-2 text-xs font-bold text-teal"><Check aria-hidden="true" className="h-4 w-4" />Created — opening Progress</span>
                                      ) : user?.role === 'community' ? (
                                        <p className="text-xs font-semibold text-navy/65">Share this recommendation with a City Planner to add it to the action plan.</p>
                                      ) : user?.role === 'engineer' && c.owner_role !== 'engineer' ? (
                                        <p className="text-xs font-semibold text-navy/65">A City Planner must assign this measure before it can be added.</p>
                                      ) : (
                                        <>
                                          <button type="button" disabled={st.state === 'adding' || !chip} onClick={() => void addToPlan(c)} className="rounded-lg bg-navy px-3.5 py-2 text-xs font-bold text-ivory transition hover:bg-navy-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:cursor-not-allowed disabled:opacity-50">
                                            {st.state === 'adding' ? 'Creating…' : 'Create action'}
                                          </button>
                                          <button type="button" onClick={() => setCard(c.card_id, { state: 'dismissed' })} className="rounded-lg px-3 py-2 text-xs font-bold text-navy/60 transition hover:bg-navy/5 hover:text-navy">Dismiss</button>
                                        </>
                                      )}
                                      {st.error && <span role="alert" className="text-xs font-semibold text-brick">{st.error}</span>}
                                    </div>
                                  </div>
                                </article>
                              </li>
                            )
                          })}
                        </ul>
                      </section>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={submit} className="border-t border-navy/10 bg-white p-3 sm:p-4">
            <div className="flex items-end gap-2 rounded-2xl border border-navy/15 bg-ivory/60 p-2 transition focus-within:border-brass/70 focus-within:ring-2 focus-within:ring-brass/20">
              <label className={`relative inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-navy/65 transition hover:bg-white hover:text-navy focus-within:outline focus-within:outline-2 focus-within:outline-brass ${attaching ? 'pointer-events-none opacity-50' : ''}`}>
                <span className="sr-only">Attach a report PDF or JSON file</span>
                <Paperclip aria-hidden="true" className="h-5 w-5" />
                <input type="file" accept=".pdf,.json,application/pdf,application/json" className="sr-only" disabled={attaching} onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachFile(f, f.name); e.target.value = '' }} />
              </label>
              <label className="block min-w-0 flex-1 text-sm font-semibold">
                <span className="sr-only">Your question</span>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input) } }}
                  rows={1}
                  maxLength={4000}
                  placeholder={chip ? 'Ask about this report…' : 'Attach a report first, then ask…'}
                  className="block max-h-36 min-h-10 w-full resize-y bg-transparent px-2 py-2 font-normal leading-5 text-navy placeholder:text-navy/45 focus:outline-none"
                />
              </label>
              {busy ? (
                <button type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop generating" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-brick/10 px-3 text-sm font-bold text-brick transition hover:bg-brick/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brick"><Square aria-hidden="true" className="h-3.5 w-3.5 fill-current" /><span className="hidden sm:inline">Stop</span></button>
              ) : (
                <button type="submit" disabled={!input.trim()} aria-label="Send message" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-navy px-3.5 text-sm font-bold text-ivory shadow-sm transition hover:bg-navy-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:cursor-not-allowed disabled:opacity-40"><Send aria-hidden="true" className="h-4 w-4" /><span className="hidden sm:inline">Send</span></button>
              )}
            </div>
            <p className="mt-2 px-1 text-[11px] leading-relaxed text-navy/50 sm:text-xs">Enter to send · Shift + Enter for a new line · Suggestions are estimates for discussion; verify against the report.</p>
          </form>
        </Card>
      </div>
    </div>
  )
}
