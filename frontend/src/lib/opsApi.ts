// Typed wrappers for the operations endpoints (auth, reports, chat, measures, evidence).
// Responses are checked just enough to fail with a clear message instead of crashing a screen.
import { ApiError, deleteJson, getBlob, patchJson, postForm, postJson, request, streamSse } from './api'
import type { IncidentReport } from './api'
import type {
  CellMeasureBrief,
  ChatEvent,
  ChatMessage,
  ChatSession,
  ChangePasswordIn,
  EffectsOut,
  Evidence,
  EvidenceKind,
  Measure,
  MeasureCreate,
  MeasureDetail,
  MeasurePatch,
  Progress,
  ProfileUpdateIn,
  Region,
  ReportChip,
  ReportStatus,
  ReportSummary,
  RoleId,
  TokenOut,
  UserOut,
  VerifyRequest,
} from './types.ops'

function as<T>(raw: unknown, what: string, check: (o: Record<string, unknown>) => boolean): T {
  if (typeof raw !== 'object' || raw === null || !check(raw as Record<string, unknown>)) {
    throw new ApiError(`The server sent an unexpected ${what} response.`, 502)
  }
  return raw as T
}

const has = (...keys: string[]) => (o: Record<string, unknown>) => keys.every((k) => k in o)
const seg = encodeURIComponent

export const opsApi = {
  // ---- auth
  login: async (username: string, password: string) =>
    as<TokenOut>(await postJson('/api/auth/login', { username, password }), 'login', has('access_token', 'user')),
  signup: async (name: string, email: string, password: string, role: RoleId) =>
    as<TokenOut>(await postJson('/api/auth/signup', { name, email, password, role }), 'sign-up', has('access_token', 'user')),
  demo: async (role: RoleId) =>
    as<TokenOut>(await postJson('/api/auth/demo', { role }), 'demo sign-in', has('access_token', 'user')),
  profile: async (signal?: AbortSignal) =>
    as<UserOut>(await request('GET', '/api/auth/me', { signal }), 'profile', has('id', 'name', 'role')),
  updateProfile: async (body: ProfileUpdateIn) =>
    as<UserOut>(await patchJson('/api/auth/profile', body), 'profile update', has('id', 'name', 'role')),
  changePassword: async (body: ChangePasswordIn) =>
    as<{ message: string }>(await postJson('/api/auth/change-password', body), 'password change', has('message')),

  effects: async (signal?: AbortSignal) =>
    as<EffectsOut>(await request('GET', '/api/effects', { signal }), 'settings', has('categories', 'credit_cap')),

  // ---- regions and reports
  resolveRegion: async (kind: string, key: string, signal?: AbortSignal) =>
    as<Region>(await request('GET', '/api/regions/resolve', { params: { kind, key }, signal }), 'region', has('name', 'cell_count')),

  createReport: async (kind: string, key: string) =>
    as<ReportStatus>(await postJson('/api/reports', { region_kind: kind, region_key: key }), 'report', has('report_id', 'status')),
  getReport: async (id: string, signal?: AbortSignal) =>
    as<ReportStatus>(await request('GET', `/api/reports/${seg(id)}`, { signal }), 'report', has('report_id', 'status')),
  listReports: async (kind: string, key: string, signal?: AbortSignal) => {
    const raw = await request('GET', '/api/reports', { params: { region_kind: kind, region_key: key }, signal })
    return Array.isArray(raw) ? (raw as ReportSummary[]) : []
  },
  reportFile: (id: string, kind: 'pdf' | 'json', signal?: AbortSignal) => getBlob(`/api/reports/${seg(id)}/${kind}`, signal),

  // ---- progress and measures
  progress: async (kind: string, key: string, signal?: AbortSignal) =>
    as<Progress>(await request('GET', `/api/regions/${seg(kind)}/${seg(key)}/progress`, { signal }), 'progress', has('measures', 'implementation_pct')),
  createMeasure: async (body: MeasureCreate) =>
    as<Measure>(await postJson('/api/measures', body), 'measure', has('id', 'status')),
  getMeasure: async (id: number, signal?: AbortSignal) =>
    as<MeasureDetail>(await request('GET', `/api/measures/${id}`, { signal }), 'measure', has('id', 'events', 'evidence')),
  patchMeasure: async (id: number, body: MeasurePatch) =>
    as<MeasureDetail>(await patchJson(`/api/measures/${id}`, body), 'measure', has('id', 'events')),
  cancelMeasure: async (id: number) =>
    as<MeasureDetail>(await deleteJson(`/api/measures/${id}`), 'measure', has('id', 'events')),
  comment: (id: number, text: string) => postJson(`/api/measures/${id}/comments`, { text }),
  verify: async (id: number, body: VerifyRequest) =>
    as<MeasureDetail>(await postJson(`/api/measures/${id}/verify`, body), 'measure', has('id', 'events')),

  incidents: async (bbox: string, signal?: AbortSignal): Promise<IncidentReport[]> => {
    const raw = await request('GET', '/api/incidents', { params: { bbox, limit: 3000 }, signal })
    const result = as<{ items: IncidentReport[] }>(raw, 'incident list', has('items'))
    return result.items
  },
  createIncident: async (body: { kind: 'crash' | 'near_miss'; lat: number; lng: number; occurred_at: string; severity?: number; reasons?: string[]; note?: string }) =>
    as<IncidentReport>(await postJson('/api/incidents', body), 'incident report', has('id', 'status', 'cell_id')),
  reviewIncident: async (id: number, body: { decision: 'confirm' | 'reject'; note?: string }) =>
    as<IncidentReport>(await postJson(`/api/incidents/${id}/review`, body), 'incident review', has('id', 'status', 'cell_id')),

  // ---- evidence
  uploadEvidence: async (
    measureId: number,
    file: Blob,
    fileName: string,
    kind: EvidenceKind,
    caption: string,
    onProgress?: (pct: number) => void,
    signal?: AbortSignal,
  ) => {
    const form = new FormData()
    form.append('file', file, fileName)
    form.append('kind', kind)
    form.append('caption', caption)
    return as<Evidence>(await postForm(`/api/measures/${measureId}/evidence`, form, onProgress, signal), 'upload', has('id', 'kind'))
  },
  evidenceImage: (url: string, signal?: AbortSignal) => getBlob(url, signal),

  /** Scored cells inside a bounding box (existing public endpoint), best first. */
  cellsInBounds: async (b: Region['bounds'], limit = 300, signal?: AbortSignal, includeLocality = false) => {
    const raw = (await request('GET', '/api/cells', {
      params: { bbox: `${b.south},${b.west},${b.north},${b.east}`, limit, include_locality: includeLocality },
      signal,
    })) as { items?: Array<{ cell_id: string; locality?: string | null; street_name?: string | null; risk_score: number | null; n_past_crashes: number; measures?: CellMeasureBrief[] }> }
    return (raw.items ?? []).map((c) => ({ cell_id: c.cell_id, locality: c.locality ?? null, street_name: c.street_name ?? null, risk_score: c.risk_score, n_past_crashes: c.n_past_crashes }))
  },

  // ---- chat
  createSession: async (role: RoleId) =>
    as<ChatSession>(await postJson('/api/chat/sessions', { role }), 'chat session', has('session_id', 'role')),
  attachReport: async (sessionId: string, file: Blob, name: string) => {
    const form = new FormData()
    form.append('file', file, name)
    return as<ReportChip>(await postForm(`/api/chat/sessions/${seg(sessionId)}/report`, form), 'report', has('report_id', 'region'))
  },
  useLatestReport: async (sessionId: string) =>
    as<ReportChip>(await postJson(`/api/chat/sessions/${seg(sessionId)}/report/latest`, {}), 'report', has('report_id', 'region')),
  history: async (sessionId: string, signal?: AbortSignal) =>
    as<{ session: ChatSession; messages: ChatMessage[] }>(
      await request('GET', `/api/chat/sessions/${seg(sessionId)}/messages`, { signal }), 'history', has('session', 'messages')),
  sendMessage: (sessionId: string, text: string, onEvent: (e: ChatEvent) => void, signal?: AbortSignal) =>
    streamSse(`/api/chat/sessions/${seg(sessionId)}/messages`, { text }, onEvent, signal),
}

/** Saves a Blob through the browser's download flow. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const regionPath = (kind: string, key: string, tab?: string) =>
  `/region/${encodeURIComponent(key)}?kind=${encodeURIComponent(kind)}${tab ? `&tab=${tab}` : ''}`
