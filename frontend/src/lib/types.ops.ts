// Types for the operations build. They mirror backend/schemas_ops.py exactly (contracts are frozen:
// change a field there and here together). Timestamps are ISO-8601 strings in UTC.

export type RoleId = 'planner' | 'engineer' | 'community'

export const ROLE_LABELS: Record<RoleId, string> = {
  planner: 'City Planners',
  engineer: 'Road Authorities',
  community: 'Traffic Police',
}

export interface UserOut {
  id: string
  name: string
  role: RoleId
}

export interface TokenOut {
  access_token: string
  token_type: string
  user: UserOut
}

export interface ProfileUpdateIn {
  name: string
}

export interface ChangePasswordIn {
  current_password: string
  new_password: string
}

// ---- configuration
export interface CategoryOut {
  id: string
  label: string
  weight: number
  default_owner: RoleId
  evidence_required: EvidenceKind[]
  placeholder: boolean
}

export interface EffectsOut {
  placeholder_weights: boolean
  credit_cap: number
  stage_factors: Record<string, number>
  categories: CategoryOut[]
  note: string
}

// ---- regions and reports
export type RegionKind = 'h3_parent' | 'locality' | 'bbox'

export interface Bounds {
  south: number
  west: number
  north: number
  east: number
}

export interface Region {
  kind: string
  key: string
  name: string
  cell_count: number
  bounds: Bounds
}

export interface HotspotCell {
  cell_id: string
  rank: number
  base_score: number | null
  n_past_crashes: number
  confidence: string | null
  emerging_risk: boolean
  risk_vs_similar_history: number | null
  lat: number
  lng: number
  locality: string | null
  google_maps_url: string
}

export interface YearCount {
  year: number
  crashes: number
}

export interface HourCount {
  hour: number
  crashes: number
}

export interface PriorityIssue {
  id: string
  title: string
  evidence: string[]
  cell_ids: string[]
  category: string | null
}

export interface RegionAnalysis {
  region: Region
  risk_index: number | null
  risk_index_method: string
  total_crashes: number | null
  emerging_cells: number
  night_share: number | null
  severe_share: number | null
  hotspots: HotspotCell[]
  year_trend: YearCount[]
  hour_of_day: HourCount[]
  priority_issues: PriorityIssue[]
  caveats: string[]
}

export interface RegionReport {
  report_id: string
  schema_version: string
  generated_at: string
  data_version: string
  analysis: RegionAnalysis
  placeholder_weights: boolean
  disclaimer: string
}

export type ReportState = 'pending' | 'ready' | 'failed'

export interface ReportSummary {
  report_id: string
  region_kind: string
  region_key: string
  status: ReportState
  created_at: string
}

export interface ReportStatus extends ReportSummary {
  error_safe: string | null
  payload: RegionReport | null
}

// ---- measures
export type MeasureStatus = 'planned' | 'in_progress' | 'evidence_submitted' | 'verified' | 'cancelled'
export type EvidenceKind = 'before' | 'during' | 'after'
export type GeoFlag = 'ok' | 'far' | 'missing'

export interface MeasureCreate {
  region_kind: string
  region_key: string
  title: string
  category: string
  cell_ids: string[]
  report_id?: string | null
  description?: string | null
  owner_role?: RoleId | null
  source?: 'chat' | 'manual'
}

export interface MeasurePatch {
  title?: string
  description?: string
  owner_role?: RoleId
  status?: MeasureStatus
  note?: string
  due_at?: string | null
  progress_note?: string | null
}

export interface VerifyRequest {
  decision: 'approve' | 'reject'
  reason?: string
}

export interface MeasureEvent {
  id: number
  type: 'created' | 'transition' | 'comment' | 'evidence' | 'verify' | 'reject'
  from_status: string | null
  to_status: string | null
  actor: string
  actor_role: string
  note: string | null
  created_at: string
}

export interface Evidence {
  id: number
  measure_id: number
  kind: EvidenceKind
  file_url: string
  thumb_url: string
  caption: string | null
  geo_flag: GeoFlag
  stale_photo: boolean
  exif_taken_at: string | null
  uploaded_by: string
  created_at: string
}

export interface Measure {
  id: number
  report_id: string | null
  region_kind: string
  region_key: string
  title: string
  category: string
  category_label: string
  description: string | null
  owner_role: RoleId
  status: MeasureStatus
  effect_weight: number
  source: string
  created_by: string
  created_at: string
  updated_at: string
  due_at?: string | null
  progress_note?: string | null
  cell_ids: string[]
  evidence_count: number
  evidence_required: EvidenceKind[]
}

export interface MeasureDetail extends Measure {
  events: MeasureEvent[]
  evidence: Evidence[]
  allowed_next: MeasureStatus[]
}

export interface RiskSnapshot {
  created_at: string
  base_index: number
  adjusted_index: number
  implementation_pct: number
  verified_pct: number
  cause_measure_id: number | null
}

export interface Progress {
  region: Region
  measures: Measure[]
  implementation_pct: number
  verified_pct: number
  base_index: number | null
  adjusted_index: number | null
  projected_index: number | null
  credit_cap: number
  placeholder_weights: boolean
  snapshots: RiskSnapshot[]
  note: string
}

export interface CellMeasureBrief {
  id: number
  title: string
  status: string
  category: string
  region_kind: string
  region_key: string
}

// ---- chat
export interface ReportChip {
  report_id: string
  region: Region
  generated_at: string
  stale: boolean
  stale_reason: string | null
}

export interface ChatSession {
  session_id: string
  role: RoleId
  report: ReportChip | null
  created_at: string
}

export interface RecommendationCard {
  card_id: string
  title: string
  category: string
  owner_role: RoleId
  cell_ids: string[]
  rationale: string
  evidence_needed: EvidenceKind[]
}

export interface ChatMessage {
  id: number
  author: 'user' | 'assistant'
  content: string
  cards: RecommendationCard[]
  fallback_mode: boolean
  created_at: string
}

export type ChatEvent =
  | { type: 'start'; session_id: string }
  | { type: 'token'; text: string }
  | { type: 'card'; card: RecommendationCard }
  | { type: 'done'; message_id: number | null; fallback_mode: boolean }
  | { type: 'error'; message: string }
