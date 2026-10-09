# WAYMARK Build: Sector Plan (hard deadline 01:30)

Spec for every agent: `waymark_implementation_prompt.md` (the "SPEC"). Each sector below says which SPEC sections it owns. Every agent gets the SPEC, the repo (or the previous agent's zip), and **its own sector prompt** from this file.

---

## 1. Timeline

Two lanes run in parallel after Sector 0, then merge in Sector 8.

| Sector | Lane | Owns (SPEC §) | Time box | Needs from | Hands off |
|---|---|---|---|---|---|
| **S0** Foundation and contracts | Both | 3.1 to 3.4, 3.6, 3.12, 6.1 to 6.3 | 30 min | repo | models, auth, config, frozen API contracts, fixtures |
| **S1** Region analysis and report | A | 3.5, 3.7, 3.8 | 50 min | S0 | region + report endpoints, PDF/JSON |
| **S2** Measures and risk overlay | A | 3.9 | 40 min | S0 (S1 not required) | measures + progress API |
| **S3** Evidence upload | A | 3.10 | 30 min | S2 | evidence API |
| **S4** Chat backend | A | 3.11 | 45 min | S0, S1 | chat API, SSE, fallback |
| **S5** Frontend base + Analysis tab | B | 4 (intro), 4.1 to 4.3 | 45 min | S0 (mocks) | API client, auth, region route |
| **S6** Frontend Assistant tab | B | 4.4 | 40 min | S5 | chat UI |
| **S7** Frontend Progress tab | B | 4.5 | 50 min | S6 | progress UI |
| **S8** Integration, map, QA, build | Merge | 4.6, 4.7, 5, 8 | 30 min | all | final build + README |

Lane A (backend) totals 195 min. Lane B (frontend) totals 135 min after S0. S8 starts when both finish.

### Clock schedule (assuming a 21:30 start; shift every row if you start later)

| Time | Lane A (backend) | Lane B (frontend) |
|---|---|---|
| 21:30 to 22:00 | **S0** | **S0** (same agent, one run) |
| 22:00 to 22:50 | S1 | S5 (22:00 to 22:45) |
| 22:50 to 23:30 | S2 | S6 (22:45 to 23:25) |
| 23:30 to 00:00 | S3 | S7 (23:25 to 00:15) |
| 00:00 to 00:45 | S4 | (S7 continues to 00:15, then idle) |
| 00:45 to 01:15 | **S8** (merge of both lanes) | |
| 01:15 to 01:30 | Buffer: fixes, final zip | |

**Latest safe start: 21:30** with two parallel lanes (3 h 45 min of work plus 15 min buffer).
If you can only run **one agent at a time**, total work is 6 h 0 min, so the latest start is **19:30**.
If you can run **three agents** after S0 (split Lane A into A1 = S1 then S4, and A2 = S2 then S3), backend finishes at 125 min, frontend at 165 min, S8 ends at 195 min, so the latest start is **22:15**.

Checkpoint rule: at each sector's end the agent must deliver its handoff pack (below). If a sector is not done at its time box, it stops, hands off what exists plus a gap list, and the cut-list in §4 applies.

---

## 2. Handoff protocol (applies to every sector)

At the end of its time box each agent produces, in the repo root:

1. `handoff/S<n>_manifest.md` containing:
   - Files **created** and **modified** (full paths).
   - Endpoints or components delivered, with one example request/response or usage line each.
   - How to run its tests (exact commands) and the result (pass/fail counts).
   - **Known gaps** and anything cut.
   - Anything the next agent must know (env vars, new dependencies).
2. A zip `handoff/S<n>_files.zip` of **only the created and modified files** (so the next agent can drop them over its repo copy).
3. A full-repo zip `handoff/S<n>_repo.zip` (excluding `node_modules`, `data/`, `.venv`).
4. Existing tests still green (original 22 plus the new ones for that sector).

The next agent starts by reading the manifests of every sector it depends on, unzipping the latest repo zip, and running the test suite before writing code.

---

## 3. Shared preamble (paste at the top of every sector prompt)

> You are one of several AI agents building features for the WAYMARK repository, one sector each. The full spec is `waymark_implementation_prompt.md`; read it and the sections your sector owns. Work only inside your sector's scope; do not refactor or "improve" other areas. Follow the existing code conventions (SQLAlchemy `Mapped[]` models, one `APIRouter(prefix="/api")` per file, Pydantic schemas, defensive TypeScript API client, Tailwind tokens from `index.css`). Keep all 22 existing tests passing and never change existing response shapes. Do not invent statistics. You have a hard time box; at 80% of it, stop adding features and finish tests plus the handoff pack. Your final output is the handoff pack described in the sector plan §2. If a requirement conflicts with the code, follow the code's convention, record the deviation in your manifest, and continue.

---

## 4. Cut-list (drop in this order if running late, never the items marked MUST)

1. HEIC support in evidence upload.
2. Dismiss button and "In plan" state polish on recommendation cards.
3. Adjusted-risk colour mode and hex markers on the map (keep the DetailPanel section).
4. Snapshot trend chart (keep the two numbers: base vs adjusted).
5. Kanban layout (use a plain list grouped by status).
6. EXIF geo-flag (keep size/type/magic-byte validation and re-encoding).
7. SSE streaming (fall back to a single JSON response; keep the same card schema).
8. Extra PDF charts beyond two (year trend and hour of day). **MUST keep** embedded JSON and Report ID in the PDF.
9. Full JWT login (fall back to demo-mode role tokens only).

**MUST keep:** region report (JSON + PDF), chat accepting the uploaded report with the three roles and recommendation cards (rule-based fallback is acceptable), measures with status flow, evidence upload, verified-only risk credit, both progress bars, adjusted index display, self-verification block.

---

## 5. Sector prompts

### S0: Foundation and contracts (30 min, one agent, both lanes depend on it)

**Scope:** SPEC §3.1 to 3.4, §3.6, §3.12, §6.1 to 6.3.

**Do:**
1. Add dependencies to `requirements.txt`; add `data/` to `.gitignore`.
2. Add all new SQLAlchemy models (`reports, measures, measure_cells, evidence, measure_events, chat_sessions, chat_messages, risk_snapshots`) with the indexes listed. Create them at start-up with `Base.metadata.create_all` (new tables only).
3. Add `backend/config/effects.json` (seed values, labels, default owners, evidence requirements) plus a loader `backend/config_loader.py` with validation and a clear error if the file is malformed.
4. Env config module (all variables in SPEC §3.2) with defaults.
5. Auth: JWT, `current_user` dependency, `POST /api/auth/login`, `POST /api/auth/demo`, role enum, and a reusable `require_role(...)` dependency. Implement the permission matrix as a single table in code (`backend/permissions.py`) so later sectors just call it.
6. CORS methods widened; `load_db.py` guard with `--force`.
7. **Freeze the contracts** (this is what lets Lane B work in parallel):
   - `backend/schemas_ops.py` with **every** Pydantic model for reports, region analysis, measures, evidence, progress, chat events and recommendation cards, exactly as the SPEC describes them.
   - `contracts/openapi_stub.json` generated from stub routers that return fixture data (every new endpoint exists and returns the fixture, status 200/202). Real sectors replace the stubs.
   - `contracts/sample_report.json`: a realistic `RegionAnalysis` payload built from the **real DB** for one real region (for example one Harris County H3 parent). Used by S4 and the frontend as a fixture.
   - `frontend/src/lib/types.ops.ts`: TypeScript types mirroring the schemas.
   - `frontend/src/lib/mocks/`: JSON fixtures for progress, measures, evidence and chat recommendation cards.
8. Tests: models create cleanly on the temp DB, config loader, permission table, auth (login, demo, bad token), CORS preflight for POST.

**Definition of done:** `pytest` green; `uvicorn backend.main:app` starts; `/docs` shows every new endpoint (stubbed); fixtures and types exist; manifest lists the frozen contract files and states **"contracts are frozen; changes need a note in the manifest"**.

**Hand off:** `handoff/S0_*`.

---

### S1: Region analysis and report generation (50 min, Lane A)

**Scope:** SPEC §3.5, §3.7, §3.8. **Depends on:** S0.

**Do:** implement `resolve_region`, `GET /api/regions/resolve`, `region_risk_index`, `analyse_region`, the report builder (JSON payload, matplotlib charts, reportlab PDF with `Report ID` in the footer and the **embedded JSON attachment**), and the `POST/GET /api/reports` endpoints with background generation and status polling. Replace the S0 stubs for these endpoints. Refactor the shared locality SQL out of `places.py` into a helper without changing its behaviour.

**Tests:** region kinds, empty/oversized regions, exact index numbers on the fixture DB, payload validates against the S0 schema, PDF produced, **embedded JSON round-trips through pypdf**, failed generation sets `status=failed` with a safe message.

**Definition of done:** generating a report for a real region from the live `waymark.db` completes in under ~10 s and the PDF opens with correct numbers; `contracts/sample_report.json` still validates against the real output.

**Cut allowed:** extra charts (§4 item 8).

**Hand off:** `handoff/S1_*` plus a sample generated PDF in `handoff/samples/`.

---

### S2: Measures, state machine and risk overlay (40 min, Lane A)

**Scope:** SPEC §3.9. **Depends on:** S0 (the `reports` table and fixtures are enough).

**Do:** `risk_overlay.py` pure functions (`stage_factor`, `implementation_pct`, `verified_pct`, per-cell `combined_credit` and `adjusted_score`, `adjusted_region_index`); the transition table; endpoints `POST/PATCH /api/measures`, comments, `verify`, and `GET /api/regions/{id}/progress`; snapshot writes on every transition; additive fields on `GET /api/cells` and `GET /api/cells/{id}` (`adjusted_risk_score`, `has_measures`, `measures`). Use `effect_weight_snapshot`. Enforce the permission matrix (self-verification blocked).

**Tests:** all formulas with exact numbers (include multiplicative combination, cap, zero-weight measures, adjusted ≤ base and ≥ 0), legal/illegal transitions (409), self-verify forbidden, approve requires `after` evidence, reject returns to `in_progress`, additive cell fields do not break the 22 existing tests.

**Definition of done:** with seeded measures you can walk `planned → in_progress → evidence_submitted → verified` through the API and watch the two percentages and the adjusted index change correctly.

**Hand off:** `handoff/S2_*`.

---

### S3: Evidence upload (30 min, Lane A)

**Scope:** SPEC §3.10. **Depends on:** S2.

**Do:** the multipart upload endpoint with magic-byte validation, size cap, Pillow re-encode, thumbnail, UUID filenames, SHA-256 duplicate rejection per measure, EXIF time/GPS read before re-encode with the `ok/far/missing` geo flag and stale-photo warning, authenticated file and thumbnail streaming, auto-move to `evidence_submitted` on `after` upload, per-user rate limit.

**Tests:** wrong type, spoofed extension, oversize, duplicate, path-traversal filename, EXIF in/out of range and missing (generate test JPEGs with Pillow/piexif or a tiny helper), auth required for download, status auto-transition, event written to `measure_events`.

**Definition of done:** upload a real phone photo via curl or `/docs`, see the thumbnail endpoint work, the geo flag set, and the measure status advance.

**Cut allowed:** HEIC, EXIF geo flag (§4 items 1 and 6).

**Hand off:** `handoff/S3_*`.

---

### S4: Chat backend (45 min, Lane A)

**Scope:** SPEC §3.11. **Depends on:** S0, S1 (use `contracts/sample_report.json` if S1 is not merged yet).

**Do:** `playbooks.py` (shared preamble plus the three role playbooks, category→owner table, `rule_based_cards`); `report_digest(payload)`; `llm.py` using the `anthropic` SDK with prompt caching on the system and digest blocks, the `propose_measures` tool, server-side validation of tool output (cell ids in report, known category, role scope), and graceful errors; endpoints for sessions, **report upload** (JSON, PDF with embedded JSON, PDF with `Report ID` fallback, rejection otherwise, stale-version warning), SSE `messages`, and history.

**Tests (mock the Anthropic client; no network):** upload paths, rejection, stale warning, SSE event order, tool-output validation drops bad cards, role-scope filtering, **no-key fallback returns cards plus the banner flag**, a prompt-injection string inside the report text is not promoted into the system prompt.

**Definition of done:** with a mocked client and with no key, a session can be created, a report uploaded, and a question answered with validated recommendation cards matching the S0 schema.

**Cut allowed:** SSE streaming (§4 item 7).

**Hand off:** `handoff/S4_*`.

---

### S5: Frontend base and Analysis tab (45 min, Lane B)

**Scope:** SPEC §4 intro, §4.1 to 4.3. **Depends on:** S0 only (develop against `frontend/src/lib/mocks/` and the S0 stub API; switch to real endpoints as S1/S2 land).

**Do:** extend `lib/api.ts` (`postJson`, `patchJson`, `postForm` with upload progress, SSE helper, auth header); `AuthContext` plus the role badge/switcher in `Nav.tsx`; the `/region/:regionId` route with the accessible three-tab shell (Analysis, Assistant, Progress; the latter two can be placeholders); the **Region report** card and "Generate analysis report" button in `MapPage.tsx`; the Analysis tab (generate, poll, render stat cards, hotspot table, recharts charts, priority issues, caveats, downloads, "Ask the assistant" hand-off); the previous-reports list.

**Definition of done:** `npm run build` clean (`tsc -b`, `oxlint`); the page works against mocks with a toggle (`VITE_USE_MOCKS=1`) and against the real backend once available; keyboard operable, aria roles on tabs.

**Hand off:** `handoff/S5_*`.

---

### S6: Frontend Assistant tab (40 min, Lane B)

**Scope:** SPEC §4.4. **Depends on:** S5.

**Do:** role selector cards; report attach area (drag-drop/picker, validation messages, report chip with out-of-date warning, "use latest report"); chat UI with streaming (or single response if SSE is cut), safe markdown (`react-markdown`, HTML disabled), stop/retry, starter chips per role, `aria-live`; **recommendation cards** with "Add to action plan" (calls `POST /api/measures`, then a toast linking to Progress), "Dismiss", "In plan" state; fallback-mode banner; disclaimer footer line.

**Definition of done:** against mocks, the full flow works: choose role, attach report, ask, see cards, add a card to the plan. Works against the real S4 API when merged.

**Cut allowed:** dismiss and polish (§4 item 2).

**Hand off:** `handoff/S6_*`.

---

### S7: Frontend Progress tab (50 min, Lane B)

**Scope:** SPEC §4.5. **Depends on:** S6.

**Do:** the accessible `ProgressBar` component (`role="progressbar"`, aria values, text alternative, framer-motion with `prefers-reduced-motion` respected, segmented variant, status shown by icon/text and not colour alone); the two bars (Implementation and Verified mitigation); the risk panel (base → adjusted with change, trend chart, the "not a model re-run" note, cap value); the measure board (list grouped by status); the measure drawer (status stepper, timeline, **evidence gallery with lightbox and before/after compare**, geo-flag chips, **upload zone** with drag-drop, mobile camera capture, multi-file, kind selector, caption, client-side downscale, progress, retry); reviewer Approve/Reject with mandatory reason; "Add measure manually"; the "regenerate report" prompt.

**Definition of done:** against mocks and then the real API: upload a photo, see status and implementation bar move while risk stays flat; approve as planner and see verified bar and adjusted index change.

**Cut allowed:** kanban, trend chart (§4 items 4 and 5).

**Hand off:** `handoff/S7_*`.

---

### S8: Integration, map, QA and final build (30 min, merge)

**Scope:** SPEC §4.6, §4.7, §5, §8. **Depends on:** all sectors.

**Do:**
1. Unzip the latest backend repo (S4) and frontend repo (S7); resolve overlaps (manifests list touched files); re-run both test suites.
2. Switch the frontend from mocks to the real API (`VITE_USE_MOCKS` off); fix contract mismatches **in the code that is wrong**, and log each in the manifest.
3. Map integration: "Adjusted risk (estimate)" colour mode, cell markers for measures, `DetailPanel` "Measures in this cell" section (additive only), legend text.
4. Run the SPEC §8 acceptance script end to end and record results (pass/fail per step, with notes).
5. README: new env vars, how to run, the `load_db.py --force` warning, the demo accounts, the risk-overlay explanation and the placeholder-weights warning.
6. `pytest`, `tsc -b`, `oxlint`, `npm run build` all clean; refresh `frontend/dist`.

**Definition of done:** SPEC §8 steps 1 to 8 pass (or failures are listed with cause). Final deliverables: `handoff/FINAL_repo.zip` and `handoff/FINAL_report.md` (what works, what was cut, known risks).

---

## 6. Per-sector go/no-go check (the human monitor's checklist)

| At | Check | If it fails |
|---|---|---|
| End of S0 | `pytest` green, `/docs` lists new endpoints, `contracts/` + mocks exist | Do not start other sectors; fix S0 first (everything depends on it) |
| End of S1 | A real region generates a PDF with Report ID and embedded JSON | Cut extra charts; S4 can continue on `sample_report.json` |
| End of S2 | Walking one measure to `verified` changes the adjusted index | Highest-priority fix; the core promise of the feature |
| End of S3 | Photo upload moves status, risk stays flat | Cut HEIC/EXIF; keep validation |
| End of S4 | No-key session returns valid cards | Cut SSE; keep cards |
| End of S5 | Analysis tab renders a report; build clean | Switch to mocks and continue S6 in parallel |
| End of S6 | Role → upload report → cards → add to plan | Cut dismiss/polish |
| End of S7 | Upload photo + review + both bars move | Cut kanban/trend |
| End of S8 | Acceptance script passes | Use the 01:15 to 01:30 buffer; ship with a gap list rather than late |
