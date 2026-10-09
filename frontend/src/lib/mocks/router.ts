// A tiny in-memory stand-in for the operations API, used when VITE_USE_MOCKS=1.
// It follows the same rules as the backend (status flow, permissions, self-verification, verified-only credit)
// closely enough to click through every screen offline. Numbers here are mock numbers, not real data.
// Endpoints it does not know (the map's cells, places, ...) fall through to the real network.
import { getAuthToken } from '../api'
import type {
  ChatEvent,
  EffectsOut,
  Evidence,
  EvidenceKind,
  Measure,
  MeasureDetail,
  MeasureEvent,
  MeasureStatus,
  Progress,
  RecommendationCard,
  RegionReport,
  ReportStatus,
  RiskSnapshot,
  RoleId,
} from '../types.ops'
import cardsFx from './cards.json'
import effectsFx from './effects.json'
import evidenceFx from './evidence.json'
import measuresFx from './measures.json'
import reportFx from './report.json'

export interface MockResult {
  status: number
  body: unknown
  message?: string
  code?: string
}
interface MockReq {
  params?: Record<string, string | number | boolean | null | undefined>
  json?: unknown
  form?: FormData
  as?: 'json' | 'blob'
}

const effects = effectsFx as unknown as EffectsOut
const baseReport = reportFx as unknown as RegionReport
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z')
const err = (status: number, message: string, code?: string): MockResult => ({ status, body: null, message, code })
const ok = (body: unknown, status = 200): MockResult => ({ status, body })

// ------------------------------------------------------------------ state
interface StoredMeasure extends Measure {
  events: MeasureEvent[]
  evidence: Evidence[]
  files: Record<number, string>
}
let nextId = 100
const measures = new Map<number, StoredMeasure>()
const reports = new Map<string, { status: ReportStatus; madeAt: number }>()
const snapshots: RiskSnapshot[] = []
const sessions = new Map<string, { role: RoleId; report: RegionReport | null; user: string }>()
let seeded = false

const category = (id: string) => effects.categories.find((c) => c.id === id)
const hotspotIds = (idx: number[]) => idx.map((i) => baseReport.analysis.hotspots[i]?.cell_id).filter(Boolean) as string[]

function user(): { id: string; role: RoleId } {
  const t = getAuthToken()
  try {
    const p = JSON.parse(atob((t ?? '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { sub: string; role: RoleId }
    return { id: p.sub, role: p.role }
  } catch {
    return { id: 'demo-planner', role: 'planner' }
  }
}

function ev(m: StoredMeasure, type: MeasureEvent['type'], u: { id: string; role: RoleId }, o: Partial<MeasureEvent> = {}) {
  m.events.push({ id: ++nextId, type, from_status: null, to_status: null, actor: u.id, actor_role: u.role, note: null, created_at: nowIso(), ...o })
  m.updated_at = nowIso()
}

function make(partial: Partial<StoredMeasure> & { title: string; category: string; cell_ids: string[] }, u: { id: string; role: RoleId }): StoredMeasure {
  const cat = category(partial.category)
  const m: StoredMeasure = {
    id: ++nextId, report_id: baseReport.report_id, region_kind: baseReport.analysis.region.kind, region_key: baseReport.analysis.region.key,
    description: null, owner_role: cat?.default_owner ?? 'planner', status: 'planned', effect_weight: cat?.weight ?? 0, source: 'manual',
    created_by: u.id, created_at: nowIso(), updated_at: nowIso(), evidence_count: 0, evidence_required: cat?.evidence_required ?? [],
    category_label: cat?.label ?? partial.category, events: [], evidence: [], files: {}, ...partial,
  }
  ev(m, 'created', u, { to_status: 'planned', note: `Created from ${m.source}` })
  measures.set(m.id, m)
  return m
}

function seed() {
  if (seeded) return
  seeded = true
  const fake = (id: string) => ({ id, role: id.replace('demo-', '') as RoleId })
  for (const t of measuresFx as Array<{ title: string; category: string; status: MeasureStatus; owner_role: RoleId; created_by: string; hotspots: number[] }>) {
    const m = make({ title: t.title, category: t.category, cell_ids: hotspotIds(t.hotspots), owner_role: t.owner_role, status: t.status, created_by: t.created_by }, fake(t.created_by))
    if (t.status !== 'planned') ev(m, 'transition', fake('demo-engineer'), { from_status: 'planned', to_status: t.status })
    ;(evidenceFx as Array<{ measure: number; kind: EvidenceKind; caption: string; geo_flag: Evidence['geo_flag']; stale_photo: boolean }>)
      .filter((e) => measuresFx[e.measure] === t || [...measures.values()].indexOf(m) === e.measure)
      .forEach((e) => addEvidence(m, e.kind, e.caption, fake('demo-engineer'), e.geo_flag, e.stale_photo, null))
  }
  record(null)
}

function addEvidence(m: StoredMeasure, kind: EvidenceKind, caption: string | null, u: { id: string; role: RoleId }, geo: Evidence['geo_flag'], stale: boolean, file: Blob | null) {
  const id = ++nextId
  m.evidence.push({
    id, measure_id: m.id, kind, file_url: `/api/evidence/${id}/file`, thumb_url: `/api/evidence/${id}/thumb`, caption, geo_flag: geo,
    stale_photo: stale, exif_taken_at: null, uploaded_by: u.id, created_at: nowIso(),
  })
  if (file) m.files[id] = URL.createObjectURL(file)
  m.evidence_count = m.evidence.length
  ev(m, 'evidence', u, { note: `${kind} photo added (${geo} location)` })
}

// ------------------------------------------------------------------ numbers (mock approximation of the overlay)
const stage = (s: MeasureStatus) => (s === 'cancelled' ? 0 : effects.stage_factors[s] ?? 0)

function numbers() {
  const active = [...measures.values()].filter((m) => m.status !== 'cancelled')
  const impl = active.length ? (active.reduce((a, m) => a + stage(m.status), 0) / active.length) * 100 : 0
  const ver = active.length ? (active.filter((m) => m.status === 'verified').length / active.length) * 100 : 0
  const base = baseReport.analysis.risk_index ?? 0
  const n = baseReport.analysis.region.cell_count || 1
  const score = new Map(baseReport.analysis.hotspots.map((h) => [h.cell_id, h.base_score ?? 0]))
  const remaining = new Map<string, number>()
  for (const m of active) {
    if (m.status !== 'verified') continue
    for (const c of m.cell_ids) remaining.set(c, (remaining.get(c) ?? 1) * (1 - m.effect_weight))
  }
  let drop = 0
  for (const [c, r] of remaining) drop += (score.get(c) ?? base) * Math.min(1 - r, effects.credit_cap)
  return { impl, ver, base, adjusted: base - drop / n, active }
}

function record(cause: number | null) {
  const n = numbers()
  snapshots.push({ created_at: nowIso(), base_index: +n.base.toFixed(2), adjusted_index: +n.adjusted.toFixed(2), implementation_pct: +n.impl.toFixed(1), verified_pct: +n.ver.toFixed(1), cause_measure_id: cause })
}

const ALLOWED: Record<string, MeasureStatus[]> = {
  planned: ['in_progress'], in_progress: ['evidence_submitted'], evidence_submitted: ['verified', 'in_progress'], verified: [], cancelled: [],
}

function detail(m: StoredMeasure, role: RoleId): MeasureDetail {
  const may = m.status === 'evidence_submitted' ? role === 'planner' : role !== 'community'
  const next = may ? (ALLOWED[m.status] ?? []) : []
  const { files: _files, ...rest } = m
  void _files
  return { ...rest, evidence_count: m.evidence.length, allowed_next: next }
}

function transition(m: StoredMeasure, to: MeasureStatus, u: { id: string; role: RoleId }, note?: string, auto = false): MockResult | null {
  const allowed = ALLOWED[m.status] ?? []
  if (!allowed.includes(to)) return err(409, `A measure that is '${m.status}' cannot move to '${to}'.`, 'illegal_transition')
  let type: MeasureEvent['type'] = 'transition'
  if (m.status === 'evidence_submitted') {
    if (u.role !== 'planner') return err(403, 'Only a planner can approve or reject submitted evidence.', 'forbidden')
    if (m.created_by === u.id || m.evidence.some((e) => e.uploaded_by === u.id)) {
      return err(403, 'You cannot review a measure you created or whose evidence you uploaded. Another reviewer needs to do this.', 'self_verification')
    }
    if (to === 'verified') {
      if (!m.evidence.some((e) => e.kind === 'after')) return err(409, "Approval needs at least one 'after' photo.", 'evidence_required')
      type = 'verify'
    } else {
      if (!note?.trim()) return err(422, 'Give a reason when sending a measure back for more work.', 'reason_required')
      type = 'reject'
    }
  } else if (!auto && u.role === 'community') {
    return err(403, `Your role (${u.role}) cannot change a measure's status.`, 'forbidden')
  } else if (to === 'evidence_submitted' && !auto && m.evidence.length === 0) {
    return err(409, 'Upload at least one photo before submitting evidence.', 'evidence_required')
  }
  const from = m.status
  m.status = to
  ev(m, type, u, { from_status: from, to_status: to, note: note ?? null })
  record(m.id)
  return null
}

// ------------------------------------------------------------------ reports
function newReportId() {
  const d = new Date()
  const hex = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, '0')
  return `WMK-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${hex}`
}

function reportPayload(id: string): RegionReport {
  return { ...baseReport, report_id: id, generated_at: nowIso() }
}

function svgBlob(label: string, color: string): Blob {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${color}"/><text x="320" y="250" font-size="40" text-anchor="middle" fill="white" font-family="sans-serif">${label}</text></svg>`
  return new Blob([svg], { type: 'image/svg+xml' })
}

// ------------------------------------------------------------------ request handler
export async function mockRequest(method: string, path: string, req: MockReq): Promise<MockResult | null> {
  seed()
  const u = user()
  const parts = path.replace(/^\/api\//, '').split('/').map(decodeURIComponent)
  const [a, b, c, d] = parts
  await new Promise((r) => setTimeout(r, 120))

  if (a === 'auth') {
    const role = a === 'auth' && b === 'demo' ? ((req.json as { role: RoleId }).role) : ((req.json as { username: RoleId }).username)
    if (!['planner', 'engineer', 'community'].includes(role)) return err(401, 'Wrong username or password.')
    const payload = btoa(JSON.stringify({ sub: b === 'demo' ? `demo-${role}` : role, role, name: `Mock ${role}`, exp: Math.floor(Date.now() / 1000) + 8 * 3600 }))
    return ok({ access_token: `mock.${payload}.sig`, token_type: 'bearer', user: { id: b === 'demo' ? `demo-${role}` : role, name: `Mock ${role}`, role } })
  }
  if (a === 'effects') return ok(effects)
  if (a === 'regions' && b === 'resolve') {
    const r = baseReport.analysis.region
    return ok(String(req.params?.key) === r.key ? r : { ...r, kind: String(req.params?.kind), key: String(req.params?.key), name: `Mock region ${String(req.params?.key)}` })
  }
  if (a === 'regions' && d === 'progress') {
    const n = numbers()
    const list = [...n.active].sort((x, y) => x.id - y.id).map((m) => detail(m, u.role)).map(({ events: _e, evidence: _v, allowed_next: _a, ...m }) => (void _e, void _v, void _a, m))
    const prog: Progress = {
      region: baseReport.analysis.region, measures: list as Measure[], implementation_pct: +n.impl.toFixed(1), verified_pct: +n.ver.toFixed(1),
      base_index: +n.base.toFixed(2), adjusted_index: +n.adjusted.toFixed(2), credit_cap: effects.credit_cap, placeholder_weights: true,
      snapshots: snapshots.slice(-100), note: effects.note,
    }
    return ok(prog)
  }

  if (a === 'reports') {
    if (!b && method === 'POST') {
      const id = newReportId()
      const r = baseReport.analysis.region
      const status: ReportStatus = { report_id: id, region_kind: r.kind, region_key: r.key, status: 'pending', error_safe: null, created_at: nowIso(), payload: null }
      reports.set(id, { status, madeAt: Date.now() })
      return ok(status, 202)
    }
    if (!b) {
      const r = baseReport.analysis.region
      const list = [...reports.values()].map((x) => x.status).filter(() => req.params?.region_key === r.key)
      return ok(list.map(({ payload: _p, error_safe: _e, ...s }) => (void _p, void _e, s)).reverse())
    }
    const rec = reports.get(b)
    if (!rec) return err(404, 'Report not found.')
    if (rec.status.status === 'pending' && Date.now() - rec.madeAt > 1500) rec.status = { ...rec.status, status: 'ready', payload: reportPayload(b) }
    if (!c) return ok(rec.status)
    if (c === 'json') return ok(new Blob([JSON.stringify(reportPayload(b), null, 2)], { type: 'application/json' }))
    return ok(new Blob([`%PDF-1.4\n% mock report ${b} (a real PDF is produced by the backend)\n`], { type: 'application/pdf' }))
  }

  if (a === 'measures') {
    if (!b && method === 'POST') {
      const body = req.json as { title: string; category: string; cell_ids: string[]; owner_role?: RoleId; description?: string; source?: 'chat' | 'manual' }
      if (!category(body.category)) return err(422, `'${body.category}' is not a known measure category.`, 'unknown_category')
      const m = make({ title: body.title, category: body.category, cell_ids: body.cell_ids, owner_role: body.owner_role ?? category(body.category)!.default_owner, description: body.description ?? null, source: body.source ?? 'manual' }, u)
      record(m.id)
      return ok(detail(m, u.role), 201)
    }
    const m = measures.get(Number(b))
    if (!m) return err(404, 'Measure not found.')
    if (c === 'evidence' && method === 'POST') {
      if (m.status === 'verified' || m.status === 'cancelled') return err(409, `A ${m.status} measure does not accept new evidence.`, 'locked')
      const file = req.form?.get('file')
      const kind = String(req.form?.get('kind')) as EvidenceKind
      if (!(file instanceof Blob) || !file.type.startsWith('image/')) return err(415, 'Only JPEG, PNG or WebP photos are accepted.', 'unsupported_type')
      addEvidence(m, kind, String(req.form?.get('caption') || '') || null, u, 'missing', false, file)
      if (kind === 'after' && m.status === 'in_progress') transition(m, 'evidence_submitted', u, 'Submitted automatically with an after photo', true)
      return ok(m.evidence[m.evidence.length - 1], 201)
    }
    if (c === 'comments') {
      ev(m, 'comment', u, { note: (req.json as { text: string }).text })
      return ok(m.events[m.events.length - 1], 201)
    }
    if (c === 'verify') {
      const body = req.json as { decision: 'approve' | 'reject'; reason?: string }
      const e = transition(m, body.decision === 'approve' ? 'verified' : 'in_progress', u, body.reason)
      return e ?? ok(detail(m, u.role))
    }
    if (method === 'PATCH') {
      const body = req.json as { title?: string; status?: MeasureStatus; note?: string }
      if (body.title) m.title = body.title
      if (body.status) {
        const e = transition(m, body.status, u, body.note)
        if (e) return e
      }
      return ok(detail(m, u.role))
    }
    if (method === 'DELETE') {
      if (m.status === 'verified' || m.status === 'cancelled') return err(409, `A ${m.status} measure cannot be cancelled.`, 'locked')
      const from = m.status
      m.status = 'cancelled'
      ev(m, 'transition', u, { from_status: from, to_status: 'cancelled', note: 'Cancelled' })
      record(m.id)
      return ok(detail(m, u.role))
    }
    return ok(detail(m, u.role))
  }

  if (a === 'evidence') {
    const id = Number(b)
    for (const m of measures.values()) {
      const e = m.evidence.find((x) => x.id === id)
      if (e) {
        const url = m.files[id]
        if (url) return ok(await (await fetch(url)).blob())
        return ok(svgBlob(`${e.kind} photo (mock)`, e.kind === 'after' ? '#2a7f8e' : e.kind === 'before' ? '#b3412f' : '#8f6a2b'))
      }
    }
    return err(404, 'Evidence not found.')
  }

  if (a === 'chat' && b === 'sessions') {
    if (!c && method === 'POST') {
      const id = `mock-${Math.random().toString(36).slice(2, 10)}`
      sessions.set(id, { role: (req.json as { role: RoleId }).role, report: null, user: u.id })
      return ok({ session_id: id, role: (req.json as { role: RoleId }).role, report: null, created_at: nowIso() }, 201)
    }
    const s = sessions.get(c)
    if (!s) return err(404, 'Chat session not found.')
    if (d === 'report') {
      if (parts[4] === 'latest') return ok(chip(s.report ?? baseReport))
      const file = req.form?.get('file')
      if (!(file instanceof Blob)) return err(422, 'That file is not a WAYMARK Region Report.')
      try {
        const parsed = JSON.parse(await file.text()) as RegionReport
        if (!parsed?.analysis?.region || !parsed.report_id) throw new Error('shape')
        s.report = parsed
        return ok(chip(parsed))
      } catch {
        return err(422, 'That file is not a WAYMARK Region Report. Upload the report PDF or JSON that you downloaded from the Analysis tab.')
      }
    }
    if (d === 'messages') return ok({ session: { session_id: c, role: s.role, report: s.report ? chip(s.report) : null, created_at: nowIso() }, messages: [] })
  }
  return null
}

function chip(r: RegionReport) {
  return { report_id: r.report_id, region: r.analysis.region, generated_at: r.generated_at, stale: false, stale_reason: null }
}

// ------------------------------------------------------------------ chat stream
export function mockStream(path: string, json: unknown, signal?: AbortSignal): AsyncGenerator<ChatEvent> | null {
  const m = /\/api\/chat\/sessions\/([^/]+)\/messages$/.exec(path)
  if (!m) return null
  const s = sessions.get(decodeURIComponent(m[1]))
  const text = String((json as { text?: string })?.text ?? '')
  const normalized = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
  const actionRequest = /recommend|suggest|what should|what can we do|what do we do|next step|action|measure|intervention|prioriti|audit first|fix first|implement/.test(normalized)
  const greeting = /^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you)( there)?\s*$/.test(normalized.trim())
  return (async function* () {
    yield { type: 'start', session_id: decodeURIComponent(m[1]) } as ChatEvent
    const a = s?.report?.analysis
    const words = !s?.report
      ? 'Attach a WAYMARK Region Report and I can answer questions about its findings.'
      : greeting
        ? `Hi! I can answer questions about the ${a!.region.name} report, such as its risk score, hotspots, or limitations. What would you like to know?`
        : actionRequest
          ? `Based on report ${s.report.report_id}, I found some relevant next steps. Review the action cards below before adding them to the plan.`
          : normalized.includes('risk index') || normalized.includes('risk score')
            ? `The ${a!.region.name} report's risk index is ${a!.risk_index} across ${a!.region.cell_count} scored cells. Risk scores are historical estimates, not predictions.`
            : normalized.includes('hotspot') || normalized.includes('highest risk')
              ? `The report ranks ${a!.hotspots.slice(0, 3).map((h) => `${h.locality || h.cell_id} (${h.n_past_crashes} past crashes)`).join('; ')} as its top hotspots.`
              : `I can answer questions using the attached ${a!.region.name} report. Try asking about its risk index, top hotspots, crash patterns, or limitations.`
    for (const w of words.split(/(?<=\s)/)) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      yield { type: 'token', text: w }
      await new Promise((r) => setTimeout(r, 25))
    }
    if (s?.report && actionRequest) {
      const owners = s.role === 'engineer' ? ['engineer'] : s.role === 'community' ? ['community', 'planner'] : ['planner', 'engineer', 'community']
      for (const t of cardsFx as Array<{ title: string; category: string; owner_role: RoleId; hotspots: number[]; rationale: string; evidence_needed: EvidenceKind[] }>) {
        const ids = t.hotspots.map((i) => s.report!.analysis.hotspots[i]?.cell_id).filter(Boolean) as string[]
        if (!owners.includes(t.owner_role) || ids.length === 0) continue
        const card: RecommendationCard = { card_id: `card-${Math.random().toString(16).slice(2, 10)}`, title: t.title, category: t.category, owner_role: t.owner_role, cell_ids: ids, rationale: t.rationale, evidence_needed: t.evidence_needed }
        yield { type: 'card', card }
      }
    }
    yield { type: 'done', message_id: Date.now(), fallback_mode: !!s?.report }
  })()
}
