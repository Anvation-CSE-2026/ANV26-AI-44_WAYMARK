import { API_BASE } from './api'

export interface ReportStatus {
  report_id: string
  region_id: string
  region_name: string
  status: string
  version: number
  error: string | null
  report: RegionAnalysis | null
}

export interface RegionAnalysis {
  report_id: string | null
  report_version: number
  region_id: string
  region_name: string
  region_kind: string
  generated_at: string | null
  base_index: number
  adjusted_index: number | null
  cells_scored: number
  crash_count: number
  hotspots: { cell_id: string; lat: number; lng: number; risk_score: number | null; n_past_crashes: number; top_factors: string[] }[]
  priority_issues: string[]
  caveats: string[]
  implementation_pct: number
  verified_pct: number
  charts: Record<string, unknown>
}

export interface Measure {
  measure_id: string
  region_id: string
  title: string
  category: string
  owner_role: string
  status: string
  effect_weight_snapshot: number
  cell_ids: string[]
  evidence_count: number
  created_by: string
  review_reason: string | null
  created_at: string
  updated_at: string
}

export interface Progress {
  region_id: string
  base_index: number
  adjusted_index: number
  change: number
  implementation_pct: number
  verified_pct: number
  measures: Measure[]
  note: string
}

export interface ChatResponse {
  message_id: string
  content: string
  fallback_mode: boolean
  cards: { card_id: string; title: string; category: string; rationale: string; cell_ids: string[]; owner_role: string; effect_weight: number }[]
}

async function token(): Promise<string> {
  const existing = localStorage.getItem('waymark.token')
  if (existing) return existing
  const response = await fetch(`${API_BASE}/api/auth/demo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: localStorage.getItem('waymark.user') ?? 'demo-user', role: localStorage.getItem('waymark.role') ?? 'planner' }),
  })
  if (!response.ok) throw new Error('Could not start demo session')
  const data = await response.json() as { access_token: string }
  localStorage.setItem('waymark.token', data.access_token)
  return data.access_token
}

export async function setDemoRole(role: 'planner' | 'engineer' | 'reviewer') {
  localStorage.setItem('waymark.role', role)
  localStorage.removeItem('waymark.token')
  await token()
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const bearer = await token()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${bearer}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail ?? `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

export const opsApi = {
  createReport: (regionId: string) => request<ReportStatus>('/api/reports', { method: 'POST', body: JSON.stringify({ region_id: regionId }) }),
  report: (id: string) => request<ReportStatus>(`/api/reports/${encodeURIComponent(id)}`),
  progress: (regionId: string) => request<Progress>(`/api/regions/${encodeURIComponent(regionId)}/progress`),
  measures: (regionId: string) => request<Measure[]>(`/api/regions/${encodeURIComponent(regionId)}/measures`),
  createMeasure: (regionId: string, title: string, category = 'corridor') => request<Measure>('/api/measures', { method: 'POST', body: JSON.stringify({ region_id: regionId, title, category }) }),
  patchMeasure: (id: string, status: string, comment?: string) => request<Measure>(`/api/measures/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status, comment, review_reason: comment }) }),
  createChat: (reportId?: string) => request<{ session_id: string; fallback_mode: boolean }>('/api/chat/sessions', { method: 'POST', body: JSON.stringify({ report_id: reportId, role: localStorage.getItem('waymark.role') ?? 'planner' }) }),
  attachChatReport: (sessionId: string, file: File) => { const body = new FormData(); body.append('file', file); return request<{ report_warning: string | null }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}/report`, { method: 'POST', body }) },
  message: (sessionId: string, content: string) => request<ChatResponse>(`/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`, { method: 'POST', body: JSON.stringify({ content }) }),
  upload: async (measureId: string, file: File, kind = 'after') => {
    const body = new FormData(); body.append('file', file); body.append('kind', kind)
    return request(`/api/measures/${encodeURIComponent(measureId)}/evidence`, { method: 'POST', body })
  },
}
