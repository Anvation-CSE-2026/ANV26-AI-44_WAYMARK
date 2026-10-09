# WAYMARK operations build: final report

Built from `waymark_implementation_prompt.md` (the SPEC) and `waymark_sector_plan.md`. One developer did all sectors (S0 to S8) in order instead of eight agents, so there are no per-sector zips; this report replaces the S0 to S8 manifests.

## Results

| Check | Result |
|---|---|
| `python -m pytest` | **203 passed** (the original 22 plus 181 new). No network; the Anthropic client is always mocked. |
| `npx tsc -b` | clean |
| `npx oxlint` | 0 errors, 1 warning that already existed in `MapLayers.tsx` before this build |
| `npm run build` | clean, `frontend/dist` refreshed |
| SPEC §8 acceptance script | **Run end to end in a real Chromium browser against a copy of the live `waymark.db` (15 of 15 steps pass)**, see below |

### Acceptance script (SPEC §8)

| # | Step | Result | Notes |
|---|---|---|---|
| 1 | Start backend + frontend, sign in as planner | PASS | `/docs` lists every new endpoint; `planner` badge in the top bar |
| 2 | Map region -> Generate analysis report | PASS | Ready in 0.7 to 1.9 s on the live data (budget 10 s). Stat cards, 10 hotspots, 2 charts, priority issues, caveats. The downloaded PDF has `Report ID …` on every page and the embedded `waymark_report.json`, equal byte for byte to the JSON download (checked with pypdf). |
| 3 | Assistant: role, attach, ask; again with no key | PASS | Report pre-attached from the Analysis tab. With `ANTHROPIC_API_KEY` unset: fallback banner plus cards. The model path (cards validated against schema, real cell ids, known category, role scope, grounded numbers, prompt-injection safety) is covered by mocked-client tests, not by a live model call. |
| 4 | Add to action plan | PASS | `planned` measure on Progress tab, card shows "In plan" |
| 5 | Engineer: start, upload before + after (GPS JPEG) | PASS | Status auto-advances; Implementation bar moves, Verified bar and adjusted index do not; thumbnail loads; geo chip "Location matches the cells" |
| 6 | Engineer cannot verify; planner rejects, resubmit, approve | PASS | Reject needs a reason and returns to in progress. Approve moves Verified bar to 50% (1 of 2 measures) and the region adjusted index from 61.83 to 61.59. Self-verification refused with the plain message. |
| 7 | Map: Adjusted risk (estimate) | PASS | Marker ◆, legend text with the placeholder flag, "Measures in this cell" showing base 100.0 to adjusted 90.0 |
| 8 | Test suites and builds | PASS | see table above; README covers every item in SPEC §5 |

Also checked: no horizontal scroll at 360 px on all three tabs; tabs operable with Left/Right/Home/End.

## What was built (by sector)

* **S0** `config.py`, `config_loader.py`, `config/effects.json` (9 categories, all placeholder), `auth.py` (JWT, PBKDF2 demo accounts, demo tokens), `permissions.py` (single table), `models_ops.py` (8 tables, created without touching existing ones), `schemas_ops.py`, CORS widened, `load_db.py --force` guard, `contracts/`, `frontend/src/lib/types.ops.ts`, `frontend/src/lib/mocks/`.
* **S1** `regions.py` (h3_parent / locality / bbox, exact index tests), `localities.py` (SQL moved out of `places.py`, behaviour unchanged), `reports/builder.py` (matplotlib charts, reportlab PDF, embedded JSON, Report ID footer), `routes/reports.py` (background generation, polling, safe failures).
* **S2** `risk_overlay.py` (pure functions), `measures_service.py`, `routes/measures.py` (state machine, comments, verify, progress, snapshots), additive fields on `/api/cells` and `/api/cells/{id}`.
* **S3** `evidence_service.py`, `routes/evidence.py` (magic-byte check, size cap, SHA-256 duplicates, EXIF before re-encode, geo and old-photo flags, Pillow re-encode, thumbnails, UUID names, rate limit, authenticated download; HEIC when `pillow-heif` is installed).
* **S4** `playbooks.py`, `llm.py`, `routes/chat.py` (three roles, rule-based cards, prompt caching, `propose_measures` tool, server-side card validation, SSE and JSON modes, stale-report warning, "use latest report").
* **S5 to S7** API client (`postJson`, `patchJson`, `postForm` with real upload progress, SSE reader, auth header, 401 sign-out, mocks), `AuthContext`, sign-in panel, role badge and switcher, `/region/:id` page with accessible tabs, Analysis, Assistant and Progress tabs, `ProgressBar`, risk panel with trend chart, measure board, measure drawer (stepper, timeline, gallery, lightbox, before/after compare, upload zone, reviewer actions), manual add form, regenerate prompt.
* **S8** map: "Adjusted risk (estimate)" colour mode, ◆ markers, "Measures in this cell" section, Region report card, README, acceptance run.

## Deviations from the SPEC (and why)

1. **`cancelled` status.** The SPEC says cancelled measures are excluded from the percentages but gives no way to cancel. Added `DELETE /api/measures/{id}` (soft delete to `cancelled`) and a fifth enum value.
2. **Self-verification vs. the acceptance script.** SPEC §3.6 blocks a user from verifying a measure they created; §8 has the same planner create and approve. The block was kept (it is the stronger rule). In the demo, create the measure as another role, or approve with the real `planner` login (a different account id from `demo-planner`). Documented in the README.
3. **Client-side downscale** only applies to photos over 8 MB. Redrawing on a canvas removes EXIF, which would make the server's geo and old-photo flags always "missing".
4. **Upload size cap "while streaming"**: Starlette spools the multipart body before the handler runs, so the cap is enforced by `Content-Length` and by reading the spooled file in chunks with an early stop. A hostile client can still make the server spool a large body to disk first; put a size limit on the reverse proxy for production.
5. **Extra fields (additive):** `chat_sessions.report_json` (to keep the attached report), `PriorityIssue.category`, `CellMeasureBrief.region_kind/region_key`, `Summary.placeholder_weights/credit_cap` (so the public map can label the adjusted mode), `GET /api/effects`, `POST /api/chat/sessions/{id}/report/latest`.
6. **Cards that cite numbers not in the report are dropped** (any number above 10 that is not in the digest). Stricter than the SPEC; it enforces "no invented statistics" but could drop a card in which the model rounds a number differently.
7. **CORS default** also allows `http://127.0.0.1:5173`; the old `WAYMARK_CORS` variable is still honoured.
8. **Region risk index** = mean `risk_score`, the same aggregation the map uses for grouped hexagons (no separate repo function existed).
9. `contracts/openapi_stub.json` is the OpenAPI document of the **real** app (every endpoint present), not a stub generated from fixture routers, because the real routes were built directly.

## Cut list

Nothing from the cut list was dropped. HEIC works only if `pillow-heif` is installed (it is in `requirements.txt`). Kanban is a status-grouped board without drag and drop.

## Known risks and gaps

* **All effect weights are placeholders.** Adjusted numbers are illustrative until a domain owner replaces `effects.json`. Site safety audits have weight 0 on purpose, so verifying one moves the Verified bar but not the adjusted index (the Risk panel says so).
* **The live model call was not exercised** (no API key in this environment). The code path is covered with a faked streaming client; run once with a real key before relying on it. Model id `claude-sonnet-5-5` is the default; change with `ANTHROPIC_MODEL`.
* Rate limiting and the demo-user table are in-process and per-server: fine for one process, not for several workers.
* Demo passwords are published in the README. Change `demo_users.json` and set `WAYMARK_DEMO_MODE=0` for anything public.
* Locality regions scan the crash table by text (`ILIKE`); a very broad name such as "Houston" exceeds the 5000-cell limit and is refused with a clear message.
* The `waymark.db.before_advice` backup in the project root is the old backup from the earlier patch and was left alone.
* Verification used a **copy** of the live database; your `waymark.db` has not been modified by testing (the new tables are added the first time you start the API on it).
