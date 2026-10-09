# WAYMARK Implementation Spec (the "SPEC")

This is the spec referenced by `waymark_sector_plan.md`. Section numbers match the "Owns (SPEC §)" column of the sector plan, so each agent can read only the sections its sector owns plus §1, §2 and §7.

> **Status of this document.** Reconstructed from the sector plan. Everything the plan states is treated as a requirement. Where the plan was silent I picked a default and tagged it **[DEFAULT]** so it can be changed in one place. Items tagged **[CONFIRM]** are product decisions a human should check before S0 starts. Nothing here is a statistic: all numeric weights are **placeholders** and must be labelled as such in the UI, the PDF and the README.

---

## 1. Purpose and scope

WAYMARK already maps spatial risk (H3 cells, per-cell `risk_score`, localities) for the Harris County area. This build adds an **action loop** on top of it:

1. **Analyse a region** and produce a **Region Report** (JSON + PDF).
2. **Ask an assistant** (three roles) about an uploaded report and get **recommendation cards** (proposed measures).
3. **Track measures** through a status flow with **photo evidence** and **human verification**.
4. Show an **adjusted risk estimate** that gives credit **only for verified measures**.

### 1.1 Non-goals
- No re-running of the underlying risk model. The adjusted index is an **overlay estimate**, not a model output. The UI, PDF and README say so.
- No new statistics. The assistant, report and cards may only cite numbers present in the report payload.
- No new user-management UI, no email, no multi-tenant org model.

### 1.2 Roles **[CONFIRM]**
Three roles, used by auth, permissions and chat playbooks:

| Role id | Label | Typical user |
|---|---|---|
| `planner` | Planner / reviewer | Approves or rejects evidence, owns the plan |
| `engineer` | Engineer / implementer | Delivers measures, uploads evidence |
| `community` | Community partner | Proposes measures, comments, uploads photos |

---

## 2. Existing codebase and conventions

- Backend: FastAPI, SQLAlchemy 2.x with `Mapped[]` models, one `APIRouter(prefix="/api")` per file, Pydantic schemas, SQLite `waymark.db`.
- Frontend: React + TypeScript + Vite, Tailwind with tokens from `index.css`, defensive TypeScript API client in `lib/api.ts`, `Nav.tsx`, `MapPage.tsx`, `DetailPanel`.
- **22 existing tests must stay green.** Never change an existing response shape; new fields on existing endpoints are **additive only**.
- Existing `data/` holds runtime files and is git-ignored.
- If a requirement here conflicts with the code's convention, follow the code and record the deviation in the sector manifest.

---

## 3. Backend

### 3.1 Dependencies and repo hygiene
Add to `requirements.txt` (pin to versions that install cleanly on the repo's Python):

| Package | Used for |
|---|---|
| `pyjwt` | JWT auth |
| `python-multipart` | multipart upload |
| `pillow` | validation, re-encode, thumbnails, EXIF read |
| `matplotlib` | report charts (use the `Agg` backend) |
| `reportlab` | PDF |
| `pypdf` | read embedded JSON in tests and in chat upload |
| `anthropic` | chat LLM |
| `pillow-heif` | optional, HEIC (first item on the cut-list) |

Add `data/` to `.gitignore`. Add `handoff/` zips to `.gitignore` is **not** required; handoff packs are deliverables.

### 3.2 Environment configuration
Single module `backend/config.py` exposing a typed settings object. Every variable has a default so the app starts with no `.env`.

| Variable | Default | Meaning |
|---|---|---|
| `WAYMARK_JWT_SECRET` | random per process, with a logged warning | JWT signing key |
| `WAYMARK_JWT_TTL_MIN` | `480` | token lifetime |
| `WAYMARK_DEMO_MODE` | `1` | enables `POST /api/auth/demo` |
| `WAYMARK_DATA_DIR` | `data` | evidence, PDFs, thumbnails |
| `WAYMARK_CORS_ORIGINS` | `http://localhost:5173` | comma list |
| `WAYMARK_MAX_UPLOAD_MB` | `10` | evidence size cap |
| `WAYMARK_UPLOAD_RATE_PER_MIN` | `10` | per-user evidence rate limit |
| `WAYMARK_MAX_REPORT_CELLS` | `5000` | region size guard |
| `WAYMARK_GEO_FAR_KM` | `1.0` | EXIF "far" threshold |
| `WAYMARK_STALE_PHOTO_DAYS` | `30` | stale-photo warning |
| `ANTHROPIC_API_KEY` | unset | unset means chat uses the rule-based fallback |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | chat model **[DEFAULT]** |
| `WAYMARK_CHAT_MAX_TOKENS` | `1500` | per reply |

Frontend (Vite): `VITE_API_BASE` (default `http://localhost:8000`), `VITE_USE_MOCKS` (`1` = serve fixtures from `lib/mocks/`).

### 3.3 Data model
Eight new tables, created at start-up with `Base.metadata.create_all` (new tables only; never alter existing ones). `Mapped[]` style. Timestamps are UTC. Ids are integer PKs unless stated.

| Table | Key columns | Indexes |
|---|---|---|
| `reports` | `report_id` (public string, unique, e.g. `WMK-20261008-A1B2C3`), `region_kind`, `region_key`, `status` (`pending/ready/failed`), `error_safe` (nullable), `payload_json`, `pdf_path`, `schema_version`, `data_version`, `created_by`, `created_at` | unique `report_id`; `(region_kind, region_key, created_at)` |
| `measures` | `report_id` FK nullable, `region_kind`, `region_key`, `title`, `category`, `description`, `owner_role`, `status`, `effect_weight_snapshot` (float), `source` (`chat/manual`), `created_by`, `created_at`, `updated_at` | `(region_kind, region_key)`; `status` |
| `measure_cells` | `measure_id` FK, `cell_id` (H3 string) | PK `(measure_id, cell_id)`; `cell_id` |
| `evidence` | `measure_id` FK, `kind` (`before/during/after`), `file_name` (UUID), `thumb_name`, `sha256`, `caption`, `exif_taken_at` (nullable), `geo_flag` (`ok/far/missing`), `stale_photo` (bool), `uploaded_by`, `created_at` | unique `(measure_id, sha256)`; `measure_id` |
| `measure_events` | `measure_id` FK, `type` (`created/transition/comment/evidence/verify/reject`), `from_status`, `to_status`, `actor`, `actor_role`, `note`, `created_at` | `(measure_id, created_at)` |
| `chat_sessions` | `session_id` (UUID string), `user_id`, `role`, `report_id` (nullable), `created_at` | `user_id` |
| `chat_messages` | `session_id` FK, `author` (`user/assistant`), `content`, `cards_json` (nullable), `fallback_mode` (bool), `created_at` | `(session_id, created_at)` |
| `risk_snapshots` | `region_kind`, `region_key`, `base_index`, `adjusted_index`, `implementation_pct`, `verified_pct`, `cause_measure_id`, `created_at` | `(region_kind, region_key, created_at)` |

`effect_weight_snapshot` copies the category weight at measure creation so later config edits do not rewrite history.

There is **no users table** **[DEFAULT]**. Accounts come from `backend/config/demo_users.json` (see §3.6).

### 3.4 Effects configuration
`backend/config/effects.json`, loaded and validated by `backend/config_loader.py`. A malformed or incomplete file raises a clear error naming the file, the key and the problem; the app refuses to start rather than guess.

```json
{
  "placeholder": true,
  "credit_cap": 0.6,
  "stage_factors": {"planned": 0.0, "in_progress": 0.25, "evidence_submitted": 0.75, "verified": 1.0},
  "categories": {
    "<category_id>": {
      "label": "Human readable name",
      "weight": 0.10,
      "default_owner": "engineer",
      "evidence_required": ["before", "after"],
      "placeholder": true
    }
  }
}
```

Rules:
- `weight` ∈ [0, 1]; `credit_cap` ∈ (0, 1]; `stage_factors` monotonically non-decreasing and `verified` = 1.0.
- `default_owner` must be a valid role id.
- Seed 5 to 8 categories that fit the repo's domain **[CONFIRM]**. Every seeded weight is a **placeholder** and `"placeholder": true` stays in the file until a domain owner replaces the values. The README and UI show a visible "placeholder weights" warning while the flag is true.
- The category to owner table used by the chat playbooks reads from `default_owner`; do not duplicate it elsewhere.

### 3.5 Region resolution and analysis
**Region kinds** **[DEFAULT]**: `h3_parent` (an H3 parent cell at a given resolution), `locality` (a named locality already in the DB), `bbox` (min/max lat/lon).

- `resolve_region(kind, key) -> Region`: validates input, returns the member cell ids, a display name and bounds. Unknown region: 404. Empty region: 422 with a clear message. More than `WAYMARK_MAX_REPORT_CELLS` cells: 422.
- `GET /api/regions/resolve?kind=&key=`: returns the `Region` (name, kind, key, cell_count, bounds). Pure read.
- `region_risk_index(cells)`: **use the repo's existing aggregation if one exists**; otherwise the mean of member-cell `risk_score`. Record the choice in the S1 manifest. The index must be deterministic and unit-tested against exact numbers on the fixture DB.
- `analyse_region(region) -> RegionAnalysis`: returns the schema in §6.1, containing at least: region meta, `risk_index`, cell count, top hotspot cells (ranked), year trend, hour-of-day distribution, `priority_issues` (derived only from data present), and `caveats`.
- Refactor the shared locality SQL out of `places.py` into a helper. **Behaviour of `places.py` must not change** (existing tests prove it).

### 3.6 Auth and permissions
Files: `backend/auth.py`, `backend/permissions.py`.

- `POST /api/auth/login` `{username, password}` returns `{access_token, token_type, user}`. Users and PBKDF2 hashes (stdlib `hashlib`) live in `backend/config/demo_users.json`: three accounts, one per role, documented in the README **[DEFAULT]**.
- `POST /api/auth/demo` `{role}` returns a token for that role with `sub = "demo-<role>"`. 404 when `WAYMARK_DEMO_MODE` is off. (Demo-mode role tokens are the cut-list fallback for full JWT.)
- JWT claims: `sub`, `role`, `name`, `exp`. Bad, expired or missing token: 401. Wrong role: 403.
- `current_user` dependency; `Role` enum; `require_role(*roles)` and `require_permission(action)` dependencies.
- **Single permission table** in `backend/permissions.py`; later sectors only call it **[DEFAULT]**:

| Action | planner | engineer | community |
|---|:-:|:-:|:-:|
| `report.create` / `report.read` | yes | yes | yes |
| `chat.use` | yes | yes | yes |
| `measure.create` | yes | yes | yes (starts as `planned`) |
| `measure.transition` (non-verify) | yes | yes | no |
| `measure.comment` | yes | yes | yes |
| `evidence.upload` | yes | yes | yes |
| `evidence.read` | yes | yes | yes |
| `measure.verify` (approve/reject) | yes | no | no |

- **Self-verification is blocked** regardless of role: a user cannot verify a measure whose evidence they uploaded or which they created. 403 with `code = "self_verification"`.
- Public (no auth): existing read endpoints, `/api/auth/*`, `/docs`. Everything new requires auth except `GET /api/regions/resolve`.

### 3.7 Report builder
Module `backend/reports/builder.py`.

- Input: a `RegionAnalysis`. Output: JSON payload (the `RegionReport` in §6.1) and a PDF at `data/reports/<report_id>.pdf`.
- **Report ID** format `WMK-<YYYYMMDD>-<6 hex>`. Printed in the PDF **footer on every page**.
- **Embedded JSON attachment**: the full payload is attached to the PDF as `waymark_report.json` (reportlab/pypdf attachment). A reader using `pypdf.PdfReader(...).attachments` recovers it byte-for-byte equal to the stored payload. **MUST keep.**
- Charts via matplotlib (`Agg`), drawn to PNG in memory: (1) year trend, (2) hour of day. Any further charts are cut-list item 8.
- PDF contents: title, region, generated-at, headline index and stat cards, hotspot table, charts, priority issues, caveats, the "estimates, not predictions; weights are placeholders when flagged" note, Report ID footer.
- Text in the PDF comes only from the payload. No invented numbers.
- Generation budget: under ~10 s for a real region on the live `waymark.db`.

### 3.8 Report endpoints
- `POST /api/reports` `{region_kind, region_key}` creates a `reports` row (`pending`), schedules generation with `BackgroundTasks`, returns **202** `{report_id, status}`.
- `GET /api/reports/{report_id}` returns status, and the payload when `ready`.
- `GET /api/reports/{report_id}/pdf` and `/json` download the artefacts (`Content-Disposition: attachment`).
- `GET /api/reports?region_kind=&region_key=` lists previous reports for a region, newest first.
- Failure: `status = failed`, `error_safe` holds a short message with **no stack trace, path or SQL**; the full error goes to the server log.
- `data_version` stores a hash of what the analysis depended on (for the stale warning in §3.11).

### 3.9 Measures, state machine and risk overlay

**Status flow**

```
planned -> in_progress -> evidence_submitted -> verified
                ^                 |
                +---- reject -----+
```

| From | To | Who | Condition |
|---|---|---|---|
| `planned` | `in_progress` | planner, engineer | none |
| `in_progress` | `evidence_submitted` | auto on `after` upload, or planner/engineer manually | manual path requires at least one evidence item |
| `evidence_submitted` | `verified` | planner, not the submitter | requires an `after` evidence item |
| `evidence_submitted` | `in_progress` | planner (reject) | mandatory reason in `note` |
| any non-final | `planned` | no | not allowed |

Illegal transition: **409** with `code = "illegal_transition"` and the allowed next statuses. Every transition writes a `measure_events` row and a `risk_snapshots` row.

**Pure functions** in `backend/risk_overlay.py` (no DB access, fully unit-testable):

```
stage_factor(status)             # from effects.json stage_factors
implementation_pct(measures)     # mean of stage_factor over measures, x100
verified_pct(measures)           # share with status == verified, x100
combined_credit(cell_measures)   # 1 - prod(1 - w_i * v_i), then min(., credit_cap)
adjusted_score(base, credit)     # base * (1 - credit), clamped to [0, base]
adjusted_region_index(cells)     # same aggregation as region_risk_index, on adjusted scores
```

where `w_i = effect_weight_snapshot` and `v_i = 1` only if the measure is `verified`, else `0`.

Rules (each needs an exact-number test):
- **Credit comes only from verified measures.** Uploading evidence changes `implementation_pct` and leaves the adjusted index unchanged.
- Combination is **multiplicative**, then **capped** at `credit_cap`.
- Measures with `weight = 0` contribute nothing and do not break the product.
- `0 <= adjusted_score <= base_score` always.
- Cancelled or deleted measures are excluded from both percentages.
- Use `effect_weight_snapshot`, never the live config value.

**Endpoints**
- `POST /api/measures` create (from a chat card or manually); body includes `region_kind`, `region_key`, `title`, `category`, `cell_ids`, optional `report_id`, `description`. Returns the `Measure`.
- `PATCH /api/measures/{id}` edit fields and/or move status (`{status, note?}`).
- `POST /api/measures/{id}/comments` `{text}`.
- `POST /api/measures/{id}/verify` `{decision: "approve"|"reject", reason}`. Reason mandatory on reject.
- `GET /api/measures/{id}` full measure with events and evidence list.
- `GET /api/regions/{kind}/{key}/progress` returns `{measures, implementation_pct, verified_pct, base_index, adjusted_index, credit_cap, placeholder_weights, snapshots}`. (`{id}` in the sector plan means this region key.)
- **Additive** fields on `GET /api/cells` and `GET /api/cells/{id}`: `adjusted_risk_score`, `has_measures`, `measures` (compact list). Existing fields untouched.

### 3.10 Evidence upload
`POST /api/measures/{id}/evidence` (multipart: `file`, `kind`, `caption`). Requires `evidence.upload`.

Pipeline, in order:
1. Rate limit per user (`WAYMARK_UPLOAD_RATE_PER_MIN`): 429.
2. Size cap (`WAYMARK_MAX_UPLOAD_MB`), enforced while streaming: 413.
3. **Magic-byte validation** (JPEG, PNG, WebP; HEIC only if `pillow-heif` is installed). The extension and the client `Content-Type` are ignored. Anything else: 415.
4. SHA-256 of the original bytes; **duplicate per measure** rejected with 409.
5. Read **EXIF capture time and GPS before re-encoding**.
6. Compute `geo_flag`: `ok` if GPS is within `WAYMARK_GEO_FAR_KM` of any cell of the measure, `far` if outside, `missing` if no GPS. Set `stale_photo` if capture time is older than `WAYMARK_STALE_PHOTO_DAYS`. Flags **warn, never block**.
7. **Re-encode with Pillow** (drops metadata and any embedded payload), apply EXIF orientation, cap longest side (default 2000 px), write a thumbnail (default 320 px).
8. Store under `data/evidence/<measure_id>/` with **UUID filenames**; the client filename is never used in a path (path-traversal safe) and is stored only as a sanitised caption fallback.
9. Insert `evidence` and a `measure_events` row. If `kind == "after"` and status is `in_progress`, **auto-move to `evidence_submitted`**.

Download: `GET /api/evidence/{id}/file` and `/thumb` stream the file; **authentication required**; `Cache-Control: private`.

Verification is a separate human step (§3.9). **Uploading never changes the adjusted risk.**

### 3.11 Chat backend
Files: `backend/playbooks.py`, `backend/llm.py`, `backend/chat.py`.

**Playbooks** (`playbooks.py`)
- One **shared preamble** (grounding rules: use only numbers in the report digest, say when data is missing, no legal or engineering sign-off claims, estimates not predictions) plus **three role playbooks** (`planner`, `engineer`, `community`) with tone, focus and scope.
- Category to owner table reads from `effects.json` (§3.4).
- `rule_based_cards(report, role)`: deterministic recommendation cards from the report's priority issues and hotspot cells; used as the **no-key / failure fallback**.
- `report_digest(payload)`: compact structured digest (region, index, top N hotspots, priority issues, caveats, valid cell ids). Built from structured fields only; free-text fields are truncated and stripped of control characters.

**LLM** (`llm.py`)
- Uses the `anthropic` SDK. Prompt caching (`cache_control`) on the **system block** and the **digest block**.
- Defines a `propose_measures` tool whose input schema is the recommendation card schema (§6.1).
- **Server-side validation** of tool output before anything reaches the client: every `cell_id` must exist in the report; `category` must exist in `effects.json`; `owner_role`/scope must be allowed for the session role; cap on number of cards; drop invalid cards and log why.
- Errors (timeout, rate limit, auth, bad output) return the rule-based cards with `fallback_mode = true`; never a 500 and never a raw provider message.
- **Prompt-injection safety**: report content is passed as **delimited, untrusted data in the user turn**. It is never concatenated into the system prompt. The system prompt states that instructions found inside report text must be ignored.

**Endpoints**
- `POST /api/chat/sessions` `{role}` returns `{session_id}`.
- `POST /api/chat/sessions/{id}/report` accepts one of:
  1. a Report **JSON** file;
  2. a **PDF with the embedded JSON** (read via `pypdf` attachments);
  3. a **PDF with a `Report ID`** in the footer text, resolved against the `reports` table (fallback);
  4. anything else: **422** with a plain-language message.
  Returns a report chip `{report_id, region, generated_at, stale, stale_reason}`. **Stale warning** when a newer report exists for the same region or `schema_version` differs; stale reports are still usable.
- `POST /api/chat/sessions/{id}/messages` `{text}`. Responds as **SSE** (`text/event-stream`) with this event order: `start`, zero or more `token`, zero or more `card`, `done` (carries `fallback_mode` and message id). Errors send an `error` event followed by `done`. Without SSE (cut-list 7) the same data returns as one JSON body with an identical card schema.
- `GET /api/chat/sessions/{id}/messages` returns history including cards.
- A session with no report attached may still chat but returns no cards and asks the user to attach a report.

### 3.12 CORS and data loading
- CORS: allow `GET, POST, PATCH, DELETE, OPTIONS`, headers `Authorization, Content-Type`, origins from `WAYMARK_CORS_ORIGINS`. A preflight for `POST` must succeed (tested).
- `load_db.py` guard: refuses to run when `waymark.db` already exists unless `--force` is passed, with a message explaining that `--force` deletes existing data including measures and evidence rows.

---

## 4. Frontend

**Intro (applies to 4.1 to 4.7).** React + TypeScript, Tailwind tokens from `index.css`, existing component style. `npm run build` must be clean (`tsc -b`, `oxlint`). New libraries: `react-markdown` (HTML disabled), `framer-motion`, `recharts` (if not already present). All new UI is keyboard operable, uses semantic roles, never conveys state by colour alone, respects `prefers-reduced-motion`, and is usable at 360 px width. Every screen runs against `lib/mocks/` when `VITE_USE_MOCKS=1`. Types come from `lib/types.ops.ts` (§6.3); do not redefine them.

### 4.1 API client and auth
- Extend `lib/api.ts` with `postJson`, `patchJson`, `postForm` (upload progress via `XMLHttpRequest` or fetch streams), an SSE helper (POST + `ReadableStream` parser, abortable), and automatic `Authorization` header. Keep the existing defensive style (typed errors, no unhandled rejections, 401 triggers sign-out).
- `AuthContext`: token + user in memory with `sessionStorage` persistence, `login`, `demoLogin(role)`, `logout`.
- `Nav.tsx`: role badge and a role switcher (demo mode) alongside the existing items.

### 4.2 Region route and map entry
- Route `/region/:regionId` with an accessible **three-tab shell**: `Analysis`, `Assistant`, `Progress` (`role="tablist"`, `tab`, `tabpanel`, arrow-key navigation, `aria-selected`, deep-linkable via `?tab=`). Assistant and Progress may be placeholders until S6/S7.
- `MapPage.tsx`: a **Region report** card with a "Generate analysis report" button for the selected region, linking to `/region/:regionId`.

### 4.3 Analysis tab
- "Generate analysis report" -> `POST /api/reports` -> poll `GET /api/reports/{id}` (backoff, timeout message) with an `aria-live` status.
- Render: stat cards, hotspot table, recharts charts (year trend, hour of day), priority issues, caveats, placeholder-weights notice when flagged.
- Downloads: PDF and JSON.
- "Ask the assistant" hand-off switches to the Assistant tab with the report pre-attached.
- **Previous reports** list for the region (open, download).
- Failed generation shows the safe message and a retry button.

### 4.4 Assistant tab
- **Role selector** cards (planner, engineer, community) with one-line descriptions; the choice creates a session.
- **Report attach area**: drag-drop and file picker; accepts the three input forms of §3.11; shows validation messages; a **report chip** with an out-of-date warning and a "use latest report" action.
- **Chat UI**: streaming tokens (or a single response if SSE is cut), safe markdown via `react-markdown` with HTML disabled and links opening with `rel="noopener noreferrer"`, **stop** and **retry**, **starter chips** per role, `aria-live="polite"` on the message list.
- **Recommendation cards**: title, category, owner, affected cells, rationale. Buttons: **Add to action plan** (`POST /api/measures`, then a toast linking to the Progress tab), **Dismiss**, and an **In plan** state once added.
- **Fallback-mode banner** when `fallback_mode` is true ("AI assistant unavailable; showing rule-based suggestions").
- Footer disclaimer: suggestions are estimates for discussion, not engineering or legal advice.

### 4.5 Progress tab
- `ProgressBar` component: `role="progressbar"`, `aria-valuenow/min/max`, a text alternative ("Implementation 40%"), framer-motion animation disabled under `prefers-reduced-motion`, a **segmented** variant, state shown by icon and text as well as colour.
- Two bars: **Implementation** and **Verified mitigation**.
- **Risk panel**: base index -> adjusted index with the change, snapshot trend chart, the "estimate, not a model re-run" note, the cap value, and the placeholder-weights notice.
- **Measure board**: list grouped by status (kanban is optional/cut-list 5).
- **Measure drawer**: status stepper, event timeline, **evidence gallery** with lightbox and **before/after compare**, geo-flag and stale-photo chips, **upload zone** (drag-drop, mobile camera capture via `capture`, multi-file, kind selector, caption, client-side downscale, progress, retry), comments.
- **Reviewer actions** (planner only): Approve / Reject with **mandatory reason on reject**; self-verification attempts show the 403 message plainly.
- "Add measure manually" form.
- **"Regenerate report"** prompt after measures change materially.

### 4.6 Map integration
- New colour mode **"Adjusted risk (estimate)"** beside the existing modes; legend text states it is an overlay estimate and shows the placeholder flag.
- **Cell markers (hex outlines or pins)** for cells that have measures, with an accessible name and a non-colour cue.
- Uses the additive fields on `GET /api/cells`. Existing modes unchanged.

### 4.7 DetailPanel
- New **"Measures in this cell"** section (additive only): base vs adjusted score, list of measures with status chips, link to the region's Progress tab. Hidden when the cell has no measures.

---

## 5. Documentation and final build

README must cover:
- New environment variables (§3.2) and how to run backend, frontend and both test suites.
- **`load_db.py --force` warning** (deletes measures and evidence rows).
- The **demo accounts** and `POST /api/auth/demo`.
- The **risk overlay explanation**: verified-only credit, multiplicative combination, cap, base vs adjusted, "not a model re-run".
- The **placeholder-weights warning** and where to change `effects.json`.
- What was cut (from `handoff/FINAL_report.md`).

Final build: `pytest`, `tsc -b`, `oxlint`, `npm run build` all clean; `frontend/dist` refreshed. Deliverables: `handoff/FINAL_repo.zip`, `handoff/FINAL_report.md`.

---

## 6. Contracts and fixtures (frozen by S0)

### 6.1 Pydantic schemas
`backend/schemas_ops.py` holds **every** model for the new endpoints. Frozen after S0; changes need a note in the manifest. Minimum set:

| Model | Fields (summary) |
|---|---|
| `Role` | enum `planner/engineer/community` |
| `UserOut`, `TokenOut` | id, name, role; access_token, token_type, user |
| `Region` | kind, key, name, cell_count, bounds |
| `HotspotCell` | cell_id, rank, base_score, incidents/count fields from the existing data, locality |
| `PriorityIssue` | id, title, evidence (numbers pulled from the payload), cell_ids |
| `RegionAnalysis` | region, risk_index, hotspots, year_trend, hour_of_day, priority_issues, caveats |
| `RegionReport` | `report_id`, `schema_version`, `generated_at`, `data_version`, `analysis`, `placeholder_weights` |
| `ReportStatus` | report_id, status, error_safe, payload (nullable) |
| `MeasureStatus` | enum of the four statuses |
| `Measure`, `MeasureCreate`, `MeasurePatch`, `Comment`, `VerifyRequest` | per §3.9 |
| `MeasureEvent` | per §3.3 |
| `Evidence` | id, kind, urls (file, thumb), caption, geo_flag, stale_photo, exif_taken_at, uploaded_by |
| `Progress` | per §3.9 progress endpoint |
| `RiskSnapshot` | per §3.3 |
| `ChatSession`, `ReportChip`, `ChatMessage` | per §3.11 |
| `RecommendationCard` | `card_id`, `title`, `category`, `owner_role`, `cell_ids`, `rationale`, `evidence_needed` |
| `ChatEvent` | union of `start/token/card/done/error` |

### 6.2 Stub API and sample payload
- `contracts/openapi_stub.json`, generated from stub routers returning fixture data. **Every new endpoint exists** and returns 200 (202 for report creation). Real sectors replace stubs.
- `contracts/sample_report.json`: a realistic `RegionReport` built from the **real DB** for one real region (for example one Harris County H3 parent). It must validate against the schema and is used by S4 and the frontend.

### 6.3 Frontend types and mocks
- `frontend/src/lib/types.ops.ts` mirrors §6.1 exactly.
- `frontend/src/lib/mocks/`: JSON fixtures for report, progress, measures, evidence and chat recommendation cards, plus a tiny mock-router used when `VITE_USE_MOCKS=1`.

---

## 7. Cross-cutting requirements

**Security**
- All new endpoints require auth except `GET /api/regions/resolve`.
- No secrets in logs. JWT secret and API key come from the environment only.
- Uploaded files are re-encoded; files are never served from a path derived from user input.
- Markdown rendering never allows raw HTML. Report text is treated as untrusted everywhere.

**Performance**
- Report generation under ~10 s for a real region; region analysis uses indexed queries.
- Progress endpoint under ~500 ms for 200 measures.

**Accessibility**
- WCAG 2.1 AA intent: focus order, visible focus, labelled controls, `aria-live` for async status, no colour-only meaning, reduced-motion respected.

**Honesty**
- No invented statistics anywhere (PDF, chat, cards, UI copy). Placeholder weights are labelled as placeholders wherever they influence a number.

**Testing**
- Backend `pytest` with a temporary DB per test session; Anthropic client always mocked; **no network in tests**.
- Original 22 tests plus each sector's new tests stay green.
- Frontend: `tsc -b` and `oxlint` clean; mocks runnable offline.

---

## 8. Acceptance script (run in S8; record pass/fail per step)

| # | Step | Pass when |
|---|---|---|
| 1 | Start backend (`uvicorn backend.main:app`) and frontend; sign in via demo as `planner`. | `/docs` lists all new endpoints; role badge shows planner. |
| 2 | On the map, select a region and click **Generate analysis report**. | Report is `ready` in under ~10 s; Analysis tab shows stat cards, hotspots, two charts, caveats; PDF has **Report ID** footer and the **embedded JSON** (verified with `pypdf`). |
| 3 | Open **Assistant**, choose a role, attach the downloaded PDF, ask "What should we do first?". Repeat with `ANTHROPIC_API_KEY` unset. | Cards validate against the schema (valid cell ids, known category, role-scoped). With no key the **fallback banner** appears and cards still show. |
| 4 | Click **Add to action plan** on a card. | A `planned` measure appears on the Progress tab; the card shows **In plan**. |
| 5 | Switch to `engineer`; move the measure to `in_progress`; upload a before and an after photo from a phone image. | Status auto-advances to `evidence_submitted`; **Implementation bar moves; Verified bar and adjusted index do not**; thumbnail loads; geo-flag chip shows ok/far/missing. |
| 6 | As `engineer` try to verify; then as `planner` reject with a reason, resubmit, and approve. | Engineer gets 403; reject returns the measure to `in_progress`; approve moves it to `verified`; **Verified bar and adjusted index change**; self-verification by the uploader is refused. |
| 7 | Return to the map; choose **Adjusted risk (estimate)**; click the affected cell. | Colour mode renders; measure marker visible; DetailPanel shows **Measures in this cell** with base vs adjusted. |
| 8 | Run `pytest`, `tsc -b`, `oxlint`, `npm run build`. | All clean; original 22 tests still pass; `frontend/dist` refreshed; README contains every item in §5. |

Failures are listed with cause in `handoff/FINAL_report.md`; the 01:15 to 01:30 buffer is for fixes, not new scope.

---

## Appendix A. Decisions to confirm before S0 starts

| Tag | Decision | Default used here |
|---|---|---|
| [CONFIRM] | Role names and labels | `planner`, `engineer`, `community` |
| [CONFIRM] | Category list and weights in `effects.json` | 5 to 8 domain categories with placeholder weights |
| [DEFAULT] | Stage factors and credit cap | 0 / 0.25 / 0.75 / 1.0; cap 0.6 |
| [DEFAULT] | Region kinds | `h3_parent`, `locality`, `bbox` |
| [DEFAULT] | Accounts without a users table | JSON file with PBKDF2 hashes plus demo tokens |
| [DEFAULT] | Region risk index aggregation | existing repo logic if present, else mean `risk_score` |
| [DEFAULT] | Chat model | `claude-sonnet-5-5` via `ANTHROPIC_MODEL` |
