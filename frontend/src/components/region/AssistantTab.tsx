import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link } from 'react-router-dom'
import { ApiError } from '../../lib/api'
import { opsApi } from '../../lib/opsApi'
import { ROLE_LABELS } from '../../lib/types.ops'
import type { ChatEvent, ChatSession, RecommendationCard, RegionReport, ReportChip, RoleId } from '../../lib/types.ops'
import { Card } from '../ui'
import { categoryLabel, fmtDate, useEffects } from '../ops/util'

const ROLE_INFO: Record<RoleId, { blurb: string; starters: string[] }> = {
  planner: {
    blurb: 'Set priorities, sequence safety work, and review evidence before approving measures.',
    starters: ['What should we do first?', 'Which cells should be audited before anything else?', 'What evidence should I ask for before approving a measure?'],
  },
  engineer: {
    blurb: 'Deliver road safety measures, inspect sites, and document the work.',
    starters: ['What should we inspect on site first?', 'Which measures can we deliver at the top hotspots?', 'What photos should I take as evidence?'],
  },
  community: {
    blurb: 'Focus on traffic safety operations, site observations, and coordination with planners.',
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
          <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-teal underline">
            {children}
          </a>
        ),
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
        code: ({ children }) => <code className="rounded bg-navy/10 px-1 font-mono text-sm">{children}</code>,
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
  const fx = useEffects()
  const [session, setSession] = useState<ChatSession | null>(null)
  const [chip, setChip] = useState<ReportChip | null>(null)
  const [attachNote, setAttachNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [creating, setCreating] = useState<RoleId | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [cards, setCards] = useState<Record<string, CardState>>({})
  const abortRef = useRef<AbortController | null>(null)
  const seq = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const lastAuto = useRef<string>('')

  const role = session?.role ?? null
  const anyFallback = msgs.some((m) => m.fallback)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [msgs])

  const startSession = async (r: RoleId) => {
    abortRef.current?.abort()
    setCreating(r)
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
      setCreating(null)
    }
  }

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

  // ------------------------------------------------------------------ role selector
  if (!session) {
    return (
      <div className="space-y-4">
        <h2 className="font-serif text-2xl font-bold">Who is asking?</h2>
        <p className="max-w-3xl text-navy/80">
          Choose a role. It sets the assistant's tone and which measures it may propose. Then attach a Region Report and
          ask a question.
        </p>
        {attachReport && (
          <p role="note" className="rounded-lg bg-brass/15 px-3 py-2 font-semibold">
            Report {attachReport.report_id} is ready to attach once you pick a role.
          </p>
        )}
        <div role="group" aria-label="Choose a role" className="grid gap-3 md:grid-cols-3">
          {(Object.keys(ROLE_INFO) as RoleId[]).map((r) => (
            <button
              key={r}
              type="button"
              disabled={creating !== null}
              onClick={() => void startSession(r)}
              className="rounded-[12px] border-2 border-navy/15 bg-white p-4 text-left shadow-card hover:border-brass disabled:opacity-60"
            >
              <span className="block font-serif text-xl font-bold">{ROLE_LABELS[r]}</span>
              <span className="mt-1 block text-navy/75">{ROLE_INFO[r].blurb}</span>
              <span className="mt-3 block text-sm font-semibold text-teal">{creating === r ? 'Starting…' : 'Start as this role →'}</span>
            </button>
          ))}
        </div>
        {createError && <p role="alert" className="font-semibold text-brick">{createError}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-serif text-2xl font-bold">Assistant</h2>
        <span className="rounded-full bg-navy px-3 py-0.5 text-sm font-semibold text-ivory">{role && ROLE_LABELS[role]}</span>
        <button type="button" onClick={() => setSession(null)} className="text-sm font-semibold text-teal underline-offset-2 hover:underline">
          Change role (starts a new chat)
        </button>
      </div>

      {/* ---------------------------------------------------------- chat */}
      {anyFallback && (
        <div role="status" className="rounded-lg border border-amber/60 bg-amber/10 px-3 py-2 font-semibold text-[#6b4210]">
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
        className={`relative flex min-h-[24rem] flex-1 flex-col rounded-[12px] ${dragging ? 'ring-2 ring-brass' : ''}`}
      >
      <Card className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-navy/10 px-4 py-3 text-sm">
          {chip ? (
            <>
              <span className="font-semibold">Attached report</span>
              <span className="rounded-full border border-teal/50 bg-teal/10 px-2 py-0.5 font-mono text-xs text-teal">{chip.report_id}</span>
              <span>{chip.region.name}</span>
              <span className="text-navy/60">Generated {fmtDate(chip.generated_at)}</span>
              {chip.stale && (
                <span role="alert" className="flex basis-full flex-wrap items-center gap-2 rounded-lg border border-amber/60 bg-amber/10 px-3 py-2 text-[#6b4210]">
                  <span aria-hidden="true">⚠</span>
                  <span className="flex-1">Out of date: {chip.stale_reason}</span>
                  <button type="button" onClick={() => void latest()} className="rounded-md bg-navy px-3 py-1 text-sm font-semibold text-ivory hover:bg-navy-800">
                    Use latest report
                  </button>
                </span>
              )}
              {otherRegion && (
                <span className="basis-full text-navy/75">
                  This report is for another region. Measures go to{' '}
                  <Link className="font-semibold text-teal underline" to={`/region/${encodeURIComponent(chip.region.key)}?kind=${encodeURIComponent(chip.region.kind)}&tab=progress`}>
                    {chip.region.name}
                  </Link>.
                </span>
              )}
            </>
          ) : (
            <span className="text-navy/70">Attach a report to get recommendations and ask report-specific questions.</span>
          )}
          {attaching && <span role="status" className="font-semibold text-teal">Attaching report…</span>}
          {attachNote && <span role={attachNote.ok ? 'status' : 'alert'} className={`basis-full font-semibold ${attachNote.ok ? 'text-teal' : 'text-brick'}`}>{attachNote.text}</span>}
        </div>
        {dragging && <p className="mx-4 mt-3 rounded-lg bg-brass/15 px-3 py-2 text-center text-sm font-semibold">Drop a report PDF or JSON file to attach it</p>}
        <div ref={listRef} aria-live="polite" aria-label="Conversation" role="log" className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {msgs.length === 0 && (
            <div>
              <p className="text-navy/75">Ask a question about the attached report, or start with one of these:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {role &&
                  ROLE_INFO[role].starters.map((s) => (
                    <button key={s} type="button" disabled={busy} onClick={() => void send(s)} className="rounded-full border border-navy/25 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-ivory-200">
                      {s}
                    </button>
                  ))}
              </div>
            </div>
          )}
          {msgs.map((m) => (
            <div key={m.key} className={m.author === 'user' ? 'flex justify-end' : ''}>
              <div className={`max-w-[48rem] rounded-[12px] px-4 py-3 ${m.author === 'user' ? 'bg-navy text-ivory' : 'bg-ivory-200/70'}`}>
                <p className="sr-only">{m.author === 'user' ? 'You said' : 'Assistant said'}</p>
                {m.author === 'assistant' && m.content === '' && m.streaming ? (
                  <p className="text-navy/70">Thinking…</p>
                ) : m.author === 'assistant' ? (
                  <Markdown text={m.content} />
                ) : (
                  <p className="whitespace-pre-wrap">{m.content}</p>
                )}
                {m.note && (
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-brick">
                    {m.note}
                    {m.question && !busy && (
                      <button type="button" onClick={() => void send(m.question ?? '')} className="rounded-md border border-brick/50 bg-white px-2 py-0.5 text-brick hover:bg-brick/10">
                        Retry
                      </button>
                    )}
                  </p>
                )}
                {m.cards.length > 0 && (
                  <section className="mt-4" aria-label="Recommended actions">
                    <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-brass-700">Recommended actions</h3>
                    <p className="mb-3 text-sm text-navy/70">Choose <strong>Create action</strong> to add a card to the plan and open Progress.</p>
                    <ul className="space-y-3">
                      {m.cards.map((c) => {
                      const st = cards[c.card_id] ?? { state: 'idle' as const }
                      if (st.state === 'dismissed') return null
                      return (
                        <li key={c.card_id}>
                          <article aria-label={`Recommendation: ${c.title}`} className="rounded-[12px] border border-navy/15 bg-white p-4 text-navy">
                            <h4 className="font-semibold">{c.title}</h4>
                            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-navy/75">
                              <span>Category: <strong>{categoryLabel(fx, c.category)}</strong></span>
                              <span>Owner: <strong>{ROLE_LABELS[c.owner_role]}</strong></span>
                              {c.evidence_needed.length > 0 && <span>Evidence: {c.evidence_needed.join(' + ')} photos</span>}
                            </p>
                            <p className="mt-2">{c.rationale}</p>
                            <p className="mt-2 text-sm text-navy/70">
                              Cells:{' '}
                              {c.cell_ids.map((id, i) => (
                                <span key={id}>
                                  {i > 0 && ', '}
                                  <Link to={`/map?cell=${encodeURIComponent(id)}`} className="font-mono text-teal underline-offset-2 hover:underline">{id}</Link>
                                </span>
                              ))}
                            </p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {st.state === 'added' ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-teal bg-teal px-3 py-1 text-sm font-semibold text-white">
                                  <span aria-hidden="true">✓</span>Created — opening Progress
                                </span>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    disabled={st.state === 'adding' || !chip}
                                    onClick={() => void addToPlan(c)}
                                    className="rounded-lg bg-navy px-3 py-1.5 text-sm font-semibold text-ivory hover:bg-navy-800 disabled:opacity-60"
                                  >
                                    {st.state === 'adding' ? 'Creating…' : 'Create action'}
                                  </button>
                                  <button type="button" onClick={() => setCard(c.card_id, { state: 'dismissed' })} className="rounded-lg border border-navy/25 px-3 py-1.5 text-sm font-semibold hover:bg-ivory-200">
                                    Dismiss
                                  </button>
                                </>
                              )}
                              {st.error && <span role="alert" className="text-sm font-semibold text-brick">{st.error}</span>}
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
        <form onSubmit={submit} className="flex flex-wrap items-stretch gap-2 border-t border-navy/10 p-3">
          <label className={`relative inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-navy/25 bg-white text-navy hover:bg-ivory-200 focus-within:outline focus-within:outline-[3px] focus-within:outline-brass ${attaching ? 'pointer-events-none opacity-50' : ''}`}>
            <span className="sr-only">Attach a report PDF or JSON file</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="m21.4 11.1-8.5 8.5a5.2 5.2 0 0 1-7.4-7.4l9.2-9.1a3.5 3.5 0 0 1 5 5l-9.2 9.2a1.7 1.7 0 0 1-2.5-2.5l8.5-8.5" />
            </svg>
            <input
              type="file"
              accept=".pdf,.json,application/pdf,application/json"
              className="sr-only"
              disabled={attaching}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void attachFile(f, f.name)
                e.target.value = ''
              }}
            />
          </label>
          <label className="block min-w-0 flex-1 text-sm font-semibold">
            <span className="sr-only">Your question</span>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send(input)
                }
              }}
              rows={1}
              maxLength={4000}
              placeholder={chip ? 'Ask about this report…' : 'Attach a report first, then ask…'}
              className="block h-10 w-full resize-none rounded-lg border border-navy/25 px-3 py-2 font-normal leading-5"
            />
          </label>
          {busy ? (
            <button type="button" onClick={() => abortRef.current?.abort()} className="h-10 shrink-0 rounded-lg border border-brick/60 px-4 py-2 font-semibold text-brick hover:bg-brick/10">
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className="h-10 shrink-0 rounded-lg bg-navy px-5 py-2 font-semibold text-ivory hover:bg-navy-800 disabled:opacity-50">
              Send
            </button>
          )}
        </form>
      </Card>
      </div>

      <p className="text-sm text-navy/70">
        Suggestions are estimates for discussion, not engineering or legal advice. Check numbers against the report.
      </p>
    </div>
  )
}
