// Typed API client for the WAYMARK FastAPI backend.
// Responses are normalised defensively so small schema differences
// (array vs {items: []}, 0-1 vs 0-100 percentiles) do not break the UI.

import type { CellMeasureBrief, ChatEvent } from './types.ops'

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
/** VITE_USE_MOCKS=1 serves the operations endpoints from lib/mocks (no backend needed for those screens). */
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === '1'

export class ApiError extends Error {
  status: number
  /** Machine-readable code from the backend (for example "illegal_transition" or "self_verification"). */
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

type Rec = Record<string, unknown>
type Params = Record<string, string | number | boolean | null | undefined>

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

const bool = (v: unknown): boolean =>
  v === true || v === 1 || v === '1' || (typeof v === 'string' && v.toLowerCase() === 'true')

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v == null ? fallback : String(v))

function pick(o: Rec, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]
  return undefined
}

function unwrapList(raw: unknown, keys: string[]): Rec[] {
  let arr: unknown = raw
  if (isRec(raw)) {
    for (const k of keys) {
      if (Array.isArray(raw[k])) {
        arr = raw[k]
        break
      }
    }
  }
  return Array.isArray(arr) ? arr.filter(isRec) : []
}

function toList(v: unknown, splitOnComma = false): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x).trim()).filter(Boolean)
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t) return []
    if (t.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(t)
        if (Array.isArray(parsed)) return parsed.map((x) => str(x).trim()).filter(Boolean)
      } catch {
        /* fall through to delimiter split */
      }
    }
    const splitter = splitOnComma ? /\s*(?:;|\||\n|,)\s*/ : /\s*(?:;|\||\n)\s*/
    return t
      .split(splitter)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return []
}

function parseExtra(v: unknown): Rec {
  if (isRec(v)) return v
  if (typeof v === 'string' && v.trim().startsWith('{')) {
    try {
      const p: unknown = JSON.parse(v)
      if (isRec(p)) return p
    } catch {
      /* ignore */
    }
  }
  return {}
}

// ---------------------------------------------------------------- fetch core

export function buildUrl(path: string, params?: Params): string {
  const qs = new URLSearchParams()
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
    }
  }
  const s = qs.toString()
  return `${API_BASE}${path}${s ? `?${s}` : ''}`
}

// ---- auth wiring (set by AuthContext)
let authToken: string | null = null
let unauthorizedHandler: (() => void) | null = null
export function setAuthToken(token: string | null) {
  authToken = token
}
export const getAuthToken = (): string | null => authToken
/** Called when a request that carried a token comes back 401 (expired session): the app signs the user out. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  unauthorizedHandler = fn
}

/** Pulls a readable message (and optional code) out of a FastAPI error body. */
function messageFrom(body: unknown): { message: string; code?: string } {
  if (isRec(body) && body.detail !== undefined) {
    const d = body.detail
    if (typeof d === 'string') return { message: d }
    if (isRec(d) && typeof d.message === 'string') {
      return { message: d.message, code: typeof d.code === 'string' ? d.code : undefined }
    }
    if (Array.isArray(d)) {
      const msgs = d.filter(isRec).map((e) => str(e.msg)).filter(Boolean)
      if (msgs.length) return { message: msgs.join('; ') }
    }
    return { message: JSON.stringify(d) }
  }
  return { message: '' }
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  let parsed: { message: string; code?: string } = { message: '' }
  try {
    parsed = messageFrom(await res.json())
  } catch {
    /* body was not JSON */
  }
  if (res.status === 401 && authToken) unauthorizedHandler?.()
  return new ApiError(parsed.message || `Request failed (${res.status})`, res.status, parsed.code)
}

const NETWORK_MESSAGE = 'Cannot reach the WAYMARK API. Check that the backend is running on port 8000.'

export interface RequestOptions {
  params?: Params
  json?: unknown
  form?: FormData
  signal?: AbortSignal
  onProgress?: (percent: number) => void
  as?: 'json' | 'blob'
}

function xhrUpload(method: string, url: string, form: FormData, o: RequestOptions): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    if (authToken) xhr.setRequestHeader('Authorization', `Bearer ${authToken}`)
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) o.onProgress?.(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onerror = () => reject(new ApiError(NETWORK_MESSAGE, 0))
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
    xhr.onload = () => {
      let body: unknown = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        o.onProgress?.(100)
        resolve(body)
        return
      }
      if (xhr.status === 401 && authToken) unauthorizedHandler?.()
      const m = messageFrom(body)
      reject(new ApiError(m.message || `Request failed (${xhr.status})`, xhr.status, m.code))
    }
    o.signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(form)
  })
}

/** One entry point for every request: mocks, auth header, upload progress, typed errors. */
export async function request(method: string, path: string, o: RequestOptions = {}): Promise<unknown> {
  if (USE_MOCKS) {
    const { mockRequest } = await import('./mocks/router')
    const m = await mockRequest(method, path, { params: o.params, json: o.json, form: o.form, as: o.as })
    if (m) {
      if (m.status >= 400) throw new ApiError(m.message ?? `Request failed (${m.status})`, m.status, m.code)
      o.onProgress?.(100)
      return m.body
    }
  }
  const url = buildUrl(path, o.params)
  if (o.form && o.onProgress) return xhrUpload(method, url, o.form, o)
  const headers: Record<string, string> = { Accept: o.as === 'blob' ? '*/*' : 'application/json' }
  if (authToken) headers.Authorization = `Bearer ${authToken}`
  let body: BodyInit | undefined
  if (o.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(o.json)
  } else if (o.form) {
    body = o.form
  }
  let res: Response
  try {
    res = await fetch(url, { method, headers, body, signal: o.signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(NETWORK_MESSAGE, 0)
  }
  if (!res.ok) throw await errorFromResponse(res)
  if (o.as === 'blob') return res.blob()
  if (res.status === 204) return null
  return res.json()
}

async function getJson(path: string, params?: Params, signal?: AbortSignal): Promise<unknown> {
  return request('GET', path, { params, signal })
}

export const postJson = (path: string, json: unknown, signal?: AbortSignal) => request('POST', path, { json, signal })
export const patchJson = (path: string, json: unknown, signal?: AbortSignal) => request('PATCH', path, { json, signal })
export const deleteJson = (path: string, signal?: AbortSignal) => request('DELETE', path, { signal })
/** Multipart upload; `onProgress` receives 0-100 (XMLHttpRequest is used so progress is real). */
export const postForm = (path: string, form: FormData, onProgress?: (pct: number) => void, signal?: AbortSignal) =>
  request('POST', path, { form, onProgress, signal })
/** Authenticated download (PDF, JSON, photos). The result is a Blob. */
export const getBlob = async (path: string, signal?: AbortSignal): Promise<Blob> =>
  (await request('GET', path, { signal, as: 'blob' })) as Blob

const SSE_TYPES = ['start', 'token', 'card', 'done', 'error']

/** Parses one text/event-stream block into an event. Unknown or malformed events are skipped. */
function parseSseBlock(block: string): ChatEvent | null {
  let data = ''
  for (const line of block.split('\n')) if (line.startsWith('data:')) data += line.slice(5).trim()
  if (!data) return null
  try {
    const ev: unknown = JSON.parse(data)
    if (isRec(ev) && typeof ev.type === 'string' && SSE_TYPES.includes(ev.type)) return ev as unknown as ChatEvent
  } catch {
    /* ignore a malformed event */
  }
  return null
}

/** POST + ReadableStream SSE reader. Abortable through `signal`. Resolves when the stream ends. */
export async function streamSse(
  path: string,
  json: unknown,
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (USE_MOCKS) {
    const { mockStream } = await import('./mocks/router')
    const stream = mockStream(path, json, signal)
    if (stream) {
      for await (const ev of stream) onEvent(ev)
      return
    }
  }
  const headers: Record<string, string> = { Accept: 'text/event-stream', 'Content-Type': 'application/json' }
  if (authToken) headers.Authorization = `Bearer ${authToken}`
  let res: Response
  try {
    res = await fetch(buildUrl(path), { method: 'POST', headers, body: JSON.stringify(json), signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(NETWORK_MESSAGE, 0)
  }
  if (!res.ok) throw await errorFromResponse(res)
  if (!res.body) throw new ApiError('The assistant did not send a response.', 502)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let i = buffer.indexOf('\n\n')
      while (i >= 0) {
        const ev = parseSseBlock(buffer.slice(0, i))
        buffer = buffer.slice(i + 2)
        if (ev) onEvent(ev)
        i = buffer.indexOf('\n\n')
      }
    }
    const last = parseSseBlock(buffer)
    if (last) onEvent(last)
  } finally {
    reader.releaseLock()
  }
}

// ---------------------------------------------------------------- types

export type Confidence = 'High' | 'Medium' | 'Low'

export interface CellLite {
  cell_id: string
  lat: number
  lng: number
  n_past_crashes: number
  risk_score: number
  risk_vs_similar_history: number | null
  /** 0-100: "riskier than X% of cells with similar history" */
  history_percentile: number | null
  confidence: Confidence
  emerging_risk: boolean
  top_factors: string[]
  /** Overlay estimate (equals risk_score until a measure is verified). */
  adjusted_risk_score: number | null
  has_measures: boolean
  measures: CellMeasureBrief[]
}

export interface ShapRow {
  feature: string
  feature_value: number | string | null
  shap_value: number
  rank: number
}

export interface CellDetail extends CellLite {
  recommendations: string[]
  shap: ShapRow[]
  confidence_explanation: string
  google_maps_url: string
  baseline_prob: number | null
}

export interface Summary {
  cells_scored: number | null
  low_history_cells: number | null
  emerging_risk_cells: number | null
  /** True while the effect weights behind the adjusted-risk overlay are still placeholders. */
  placeholder_weights: boolean
  credit_cap: number | null
}

export interface WhatIfCell {
  baseline: number | null
  scenario: number | null
}

export interface WhatIf {
  byCell: Map<string, WhatIfCell>
  maxAbsDelta: number
}

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL'

export interface DqCheck {
  check_name: string
  status: CheckStatus
  detail: string
}

export interface YearMonth {
  year: number
  month: number | null
  crashes: number
}

export interface Validation {
  checks: DqCheck[]
  counts: YearMonth[]
}

export interface MetricRow {
  group_name: string
  metric_name: string
  model_value: number | null
  history_value: number | null
  extra: Rec
}

export interface AuditRow extends CellLite {
  rank: number
  region: string
  locality: string | null
}

// ---------------------------------------------------------------- normalisers

let pctIsFraction = false

function toConfidence(v: unknown): Confidence {
  const s = str(v).toLowerCase()
  if (s.startsWith('h')) return 'High'
  if (s.startsWith('m')) return 'Medium'
  return 'Low'
}

function toCellLite(r: Rec): CellLite | null {
  const id = str(pick(r, ['cell_id', 'h3', 'h3_id', 'id']))
  const lat = num(pick(r, ['lat', 'latitude']))
  const lng = num(pick(r, ['lng', 'lon', 'longitude']))
  if (!id || lat === null || lng === null) return null
  return {
    cell_id: id,
    lat,
    lng,
    n_past_crashes: num(pick(r, ['n_past_crashes', 'past_crashes'])) ?? 0,
    risk_score: num(pick(r, ['risk_score', 'score'])) ?? 0,
    risk_vs_similar_history: num(r.risk_vs_similar_history),
    history_percentile: num(r.history_percentile),
    confidence: toConfidence(r.confidence),
    emerging_risk: bool(r.emerging_risk),
    top_factors: toList(r.top_factors, true),
    adjusted_risk_score: num(r.adjusted_risk_score),
    has_measures: bool(r.has_measures),
    measures: unwrapList(r.measures ?? [], ['items']).map((m) => ({
      id: num(m.id) ?? 0,
      title: str(m.title),
      status: str(m.status),
      category: str(m.category),
      region_kind: str(m.region_kind, 'h3_parent'),
      region_key: str(m.region_key),
    })),
  }
}

/** Detects whether percentiles arrive as 0-1 fractions and rescales to 0-100. */
function finishCells<T extends { history_percentile: number | null }>(list: T[]): T[] {
  const vals = list.map((c) => c.history_percentile).filter((v): v is number => v !== null)
  if (vals.length >= 20) pctIsFraction = vals.reduce((m, v) => Math.max(m, v), 0) <= 1
  if (!pctIsFraction) return list
  return list.map((c) =>
    c.history_percentile === null ? c : { ...c, history_percentile: c.history_percentile * 100 },
  )
}

function toSummary(raw: unknown): Summary {
  const r = isRec(raw) ? raw : {}
  const nested = isRec(r.summary) ? r.summary : {}
  const get = (keys: string[]) => num(pick(r, keys) ?? pick(nested, keys))
  return {
    cells_scored: get(['cells_scored', 'n_cells', 'total_cells', 'cells']),
    low_history_cells: get(['low_history_cells', 'n_low_history']),
    emerging_risk_cells: get(['emerging_risk_cells', 'emerging_cells', 'n_emerging']),
    placeholder_weights: r.placeholder_weights === undefined ? true : bool(r.placeholder_weights),
    credit_cap: num(r.credit_cap),
  }
}

function toCellDetail(raw: unknown): CellDetail {
  if (!isRec(raw)) throw new ApiError('Unexpected response for this cell.', 500)
  const root: Rec = isRec(raw.cell) ? { ...raw, ...raw.cell } : raw
  const base = toCellLite(root)
  if (!base) throw new ApiError('This cell has no coordinates in the database.', 500)
  const shapRaw = unwrapList(pick(root, ['shap', 'shap_contributions', 'contributions', 'shap_values']) ?? [], ['items'])
  const shap: ShapRow[] = shapRaw
    .map((s, i) => {
      const fv = pick(s, ['feature_value', 'value'])
      return {
        feature: str(pick(s, ['feature', 'name'])),
        feature_value: typeof fv === 'number' || typeof fv === 'string' ? fv : null,
        shap_value: num(pick(s, ['shap_value', 'shap', 'contribution'])) ?? 0,
        rank: num(s.rank) ?? i + 1,
      }
    })
    .filter((s) => s.feature)
    .sort((a, b) => a.rank - b.rank)
  const percentile =
    pctIsFraction && base.history_percentile !== null ? base.history_percentile * 100 : base.history_percentile
  return {
    ...base,
    history_percentile: percentile,
    recommendations: toList(pick(root, ['recommendations', 'suggested_actions', 'actions'])),
    shap,
    confidence_explanation: str(pick(root, ['confidence_explanation', 'confidence_reason'])),
    google_maps_url:
      str(pick(root, ['google_maps_url', 'google_maps_link', 'maps_url'])) ||
      `https://www.google.com/maps?q=${base.lat},${base.lng}`,
    baseline_prob: num(pick(root, ['baseline_prob', 'baseline_probability'])),
  }
}

function toWhatIf(raw: unknown): WhatIf {
  const byCell = new Map<string, WhatIfCell>()
  let maxAbsDelta = 0
  const root: Rec = isRec(raw) ? raw : {}
  const source = pick(root, ['cells', 'items', 'results', 'data'])
  const add = (id: string, baseline: number | null, scenario: number | null) => {
    if (!id) return
    byCell.set(id, { baseline, scenario })
    if (baseline !== null && scenario !== null) maxAbsDelta = Math.max(maxAbsDelta, Math.abs(scenario - baseline))
  }
  if (Array.isArray(source) || Array.isArray(raw)) {
    for (const r of unwrapList(raw, ['cells', 'items', 'results', 'data'])) {
      add(
        str(pick(r, ['cell_id', 'id'])),
        num(pick(r, ['baseline_prob', 'baseline', 'baseline_probability'])),
        num(pick(r, ['scenario_prob', 'scenario', 'scenario_probability', 'probability'])),
      )
    }
  } else if (isRec(source)) {
    for (const [id, v] of Object.entries(source)) {
      if (isRec(v)) {
        add(
          id,
          num(pick(v, ['baseline_prob', 'baseline', 'baseline_probability'])),
          num(pick(v, ['scenario_prob', 'scenario', 'scenario_probability', 'probability'])),
        )
      }
    }
  }
  return { byCell, maxAbsDelta }
}

function toValidation(raw: unknown): Validation {
  const root: Rec = isRec(raw) ? raw : {}
  const checks: DqCheck[] = unwrapList(raw, ['checks', 'data_quality', 'items']).map((c) => {
    const s = str(pick(c, ['status', 'result'])).toUpperCase()
    const status: CheckStatus = s.startsWith('PASS') || s === 'OK' ? 'PASS' : s.startsWith('FAIL') ? 'FAIL' : 'WARN'
    return {
      check_name: str(pick(c, ['check_name', 'name', 'check'])),
      status,
      detail: str(pick(c, ['detail', 'explanation', 'message'])),
    }
  })
  const countsRaw = pick(root, ['yearly_counts', 'counts', 'monthly_counts', 'yearly', 'monthly']) ?? []
  const counts: YearMonth[] = unwrapList(countsRaw, ['items', 'rows'])
    .map((c) => ({
      year: num(c.year) ?? NaN,
      month: num(c.month),
      crashes: num(pick(c, ['crashes', 'count', 'n'])) ?? 0,
    }))
    .filter((c) => Number.isFinite(c.year))
  return { checks, counts }
}

function toMetricRows(raw: unknown): MetricRow[] {
  const rows: MetricRow[] = []
  const pushRow = (r: Rec, group?: string) => {
    rows.push({
      group_name: str(pick(r, ['group_name', 'group']), group ?? 'general'),
      metric_name: str(pick(r, ['metric_name', 'metric', 'name'])),
      model_value: num(pick(r, ['model_value', 'model'])),
      history_value: num(pick(r, ['history_value', 'history', 'baseline'])),
      extra: parseExtra(pick(r, ['extra_json', 'extra'])),
    })
  }
  if (Array.isArray(raw)) {
    raw.filter(isRec).forEach((r) => pushRow(r))
  } else if (isRec(raw)) {
    const direct = unwrapList(raw, ['metrics', 'rows', 'items'])
    if (direct.length) {
      direct.forEach((r) => pushRow(r))
    } else {
      const pushGroup = (fallbackGroup: string, value: unknown) => {
        if (!isRec(value)) return
        const groupName = str(value.group_name, fallbackGroup)
        const metrics = isRec(value.metrics) ? value.metrics : null
        if (metrics) {
          for (const [metric, metricValue] of Object.entries(metrics)) {
            if (isRec(metricValue)) {
              pushRow({ ...metricValue, group_name: groupName, metric_name: metric }, groupName)
            }
          }
          return
        }
        if (fallbackGroup === 'bootstrap' && isRec(value.model)) {
          const model = isRec(value.model) ? num(value.model.point) : null
          const history = isRec(value.history) ? num(value.history.point) : null
          pushRow({ group_name: 'bootstrap_low_history', metric_name: 'capture_top10', model_value: model,
            history_value: history, extra: value }, 'bootstrap_low_history')
        }
      }
      for (const [group, v] of Object.entries(raw)) {
        if (Array.isArray(v)) v.forEach((item) => pushGroup(group, item))
        else pushGroup(group, v)
      }
    }
  }
  return rows.filter((r) => r.metric_name)
}

function toAuditRows(raw: unknown): AuditRow[] {
  const list = unwrapList(raw, ['items', 'cells', 'audit_list', 'data', 'results'])
  const rows: AuditRow[] = []
  list.forEach((r, i) => {
    const c = toCellLite(r)
    if (c) rows.push({ ...c, rank: num(r.rank) ?? i + 1, region: str(r.region, 'Unknown'), locality: str(r.locality) || null })
  })
  return finishCells(rows)
}

// ---------------------------------------------------------------- endpoints

export interface CrashPoint {
  crash_id: string
  cell_id: string
  lat: number
  lng: number
  start_time: string | null
  severity: number | null
  weather: string | null
  night: boolean
}

export interface CrashResult {
  available: boolean
  total: number
  truncated: boolean
  items: CrashPoint[]
}

export interface PlaceSearchItem {
  name: string
  kind: string
  crash_count: number
  cell_ids: string[]
  south: number
  west: number
  north: number
  east: number
}

export const api = {
  /** Real crash points inside a map view; bbox = south,west,north,east. */
  crashes: async (bbox: string, signal?: AbortSignal): Promise<CrashResult> => {
    const raw = await getJson('/api/crashes', { bbox, limit: 3000 }, signal)
    const r: Rec = isRec(raw) ? raw : {}
    const items: CrashPoint[] = []
    for (const o of unwrapList(r.items ?? [], ['items'])) {
      const lat = num(o.lat)
      const lng = num(o.lng)
      if (lat === null || lng === null) continue
      items.push({
        crash_id: str(o.crash_id),
        cell_id: str(o.cell_id),
        lat,
        lng,
        start_time: o.start_time == null ? null : str(o.start_time),
        severity: num(o.severity),
        weather: o.weather == null || o.weather === '' ? null : str(o.weather),
        night: bool(o.night),
      })
    }
    return { available: r.available !== false, total: num(r.total) ?? items.length, truncated: bool(r.truncated), items }
  },

  health: (signal?: AbortSignal) => getJson('/api/health', undefined, signal),

  summary: async (signal?: AbortSignal) => toSummary(await getJson('/api/summary', undefined, signal)),

  /** Tries a large limit first, then falls back if the backend caps it. */
  cells: async (signal?: AbortSignal): Promise<CellLite[]> => {
    let raw: unknown = null
    let lastError: unknown = null
    for (const limit of [20000, 5000, undefined]) {
      try {
        raw = await getJson('/api/cells', { limit }, signal)
        lastError = null
        break
      } catch (e) {
        lastError = e
        if (!(e instanceof ApiError) || e.status !== 422) throw e
      }
    }
    if (lastError) throw lastError
    const list = unwrapList(raw, ['items', 'cells', 'data', 'results'])
      .map(toCellLite)
      .filter((c): c is CellLite => c !== null)
    return finishCells(list)
  },

  cell: async (id: string, signal?: AbortSignal) =>
    toCellDetail(await getJson(`/api/cells/${encodeURIComponent(id)}`, undefined, signal)),

  places: async (query: string, signal?: AbortSignal, prefix = false): Promise<PlaceSearchItem[]> => {
    const raw = await getJson('/api/places', { q: query, prefix }, signal)
    return unwrapList(raw, ['items', 'places', 'results']).flatMap((r) => {
      const ids = Array.isArray(r.cell_ids) ? r.cell_ids.map((id) => str(id)).filter(Boolean) : []
      const south = num(r.south)
      const west = num(r.west)
      const north = num(r.north)
      const east = num(r.east)
      return south === null || west === null || north === null || east === null
        ? []
        : [{
            name: str(r.name),
            kind: str(r.kind),
            crash_count: num(r.crash_count) ?? 0,
            cell_ids: ids,
            south,
            west,
            north,
            east,
          }]
    })
  },

  whatif: async (night: boolean, rain: boolean, lowVis: boolean, signal?: AbortSignal) =>
    toWhatIf(await getJson('/api/whatif', { night, rain, low_vis: lowVis }, signal)),

  validation: async (signal?: AbortSignal) => toValidation(await getJson('/api/validation', undefined, signal)),

  metrics: async (signal?: AbortSignal) => toMetricRows(await getJson('/api/metrics', undefined, signal)),

  auditList: async (signal?: AbortSignal) => toAuditRows(await getJson('/api/audit-list', undefined, signal)),
}

export const auditCsvUrl = () => buildUrl('/api/audit-list', { format: 'csv' })
