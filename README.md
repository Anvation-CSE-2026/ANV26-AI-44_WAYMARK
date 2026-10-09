<div align="center">

# WAYMARK

### Explainable road-safety decision support

Identify locations that may merit earlier investigation, including places with limited crash history. Review the signals, discuss recommendations, and track evidence through a human-reviewed action plan.

![React](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript&logoColor=white)
![FastAPI](https://img.shields.io/badge/API-FastAPI-009688?logo=fastapi&logoColor=white)
![Deployment target](https://img.shields.io/badge/Target-Vercel%20%2B%20Render-111111?logo=vercel&logoColor=white)

[Features](#features) · [At a glance](#at-a-glance) · [Setup](#local-setup) · [Deployment](#deployment) · [Limitations](#limitations-and-responsible-use)

**Live demo:** [Open WAYMARK](https://waymark-frontend.onrender.com/)

</div>

> Decision support only. Human experts decide. Risk scores are estimates from historical records.

## At a glance

| Item | Details |
| --- | --- |
| Frontend | React, TypeScript, Vite, and Tailwind CSS in `frontend/` |
| Frontend hosting | Vercel static deployment; Vite output directory: `frontend/dist/` |
| Backend | FastAPI application in `backend/`, served with Uvicorn |
| Backend hosting | Render Web Service |
| Database | SQLite (`waymark.db`) with scored cells and operational data |
| Runtime files | Evidence images and generated report files in `data/` by default |
| Study area | Houston, Texas, using H3 cells |
| Data source | US Accidents (2016–2023), attributed to Sobhan Moosavi and collaborators |
| Assistant | Groq or Anthropic when configured; rule-based fallback otherwise |

## Features

- **Risk map:** explore H3 cells and regions, search localities, and filter by confidence, crash history, or emerging-risk status.
- **Blackspot likelihood:** inspect each cell's estimated likelihood of meeting the project threshold, with confidence, crash history, and model factors.
- **What-if comparisons:** view scenario simulations for night, rain, and low visibility.
- **Model evidence:** review backtest metrics, robustness comparisons, and dataset quality checks alongside caveats.
- **Audit list:** search and sort emerging-risk cells and download the list as CSV.
- **Region reports:** generate hotspot analysis and download a PDF or JSON report.
- **AI assistant:** ask questions about an attached report and review structured action recommendations.
- **Action tracking:** move measures through planned, in-progress, evidence-submitted, and verified states, with photo evidence and planner review.
- **Adjusted risk overlay:** display estimated score reductions from verified measures. The current effect weights are placeholders and the overlay does not rerun the model.

The current scored dataset covers Houston, Texas, using H3 hexagonal cells. The application is a decision-support prototype: its scores are estimates from historical records, not predictions or engineering findings. Human experts make all audit and intervention decisions.

## What the application does

- **Explore the map:** inspect scored cells and grouped regions, search by locality or region, filter by confidence, crash history, or emerging-risk status, and open cell details.
- **Review risk signals:** examine crash history, model-estimated blackspot likelihood, confidence, contributing factors, and links to map locations. The primary measure highlighted by WAYMARK is the estimated likelihood that a cell reaches the defined blackspot threshold.
- **Compare scenarios:** view illustrative changes under night, rain, and low-visibility conditions. These are scenario simulations, not live forecasts.
- **Review model evidence:** inspect backtest results, robustness comparisons, and data-quality checks, with limitations shown alongside the metrics.
- **Prioritize audits:** search, sort, and download the emerging-risk audit list.
- **Generate region reports:** create a region analysis with summary metrics, hotspot cells, trends, priority issues, caveats, and PDF and JSON downloads.
- **Ask the assistant:** attach a region report and ask questions. The assistant can provide structured recommendation cards for discussion; without a configured model provider, the application uses a rule-based fallback.
- **Track measures:** create or propose measures, record progress, attach before-and-after evidence, and ask a planner to approve or reject submitted evidence.
- **View the adjusted estimate:** see an overlay that applies credit only to verified measures. The overlay is illustrative and does not rerun the risk model.

## Project structure

| Path | Purpose |
| --- | --- |
| `backend/` | FastAPI application, API routes, authentication, reporting, assistant integration, evidence handling, and risk overlay. |
| `backend/config/` | Demo accounts and intervention effect configuration. |
| `frontend/` | Main React application: landing page, map, analysis pages, assistant, and action-plan interface. |
| `main_page/` | Standalone source for the original marketing and product-story page. Keep its source independent of the main application. |
| `pipeline/` | Data validation, export, database loading, crash-point loading, advice generation, and API contract utilities. |
| `blackspot_pipeline.py` | Feature engineering, model training/scoring, and initial model artifact generation. |
| `contracts/` | Sample report payload and API schema snapshot used for reference and frontend fixtures. |
| `out/` | Model artifacts, scores, metrics, quality results, and exported tables used to build the database. |
| `data/` | Runtime report PDFs and evidence images. This directory may contain user-generated data. |
| `waymark.db` | SQLite application database containing scored cells, model evidence, and operational records. |
| `handoff/` | Project handoff report and sample deliverables. |

The frontend and backend have separate READMEs with implementation-specific details: [frontend/README.md](frontend/README.md) and [main_page/README.md](main_page/README.md).

## Requirements

- Python 3.11 or later, using versions supported by the libraries in `requirements.txt`.
- Node.js and npm compatible with the Vite version in `frontend/package.json` (Node.js 20 or later is recommended).
- The supplied `waymark.db` and `out/` artifacts to run the application as provided.
- Optional: a Groq or Anthropic API key for model-backed assistant responses.
- Optional: a MapTiler API key for alternate map styles. OpenStreetMap tiles work without an application key.

## Local setup

Run commands from the project root unless a command changes directories.

### 1. Create and activate a Python environment

Linux or macOS:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 2. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 3. Configure optional services

The backend reads environment variables from the process environment and from a root-level `.env` file. No `.env.example` is currently provided at the project root. Create `.env` only when you need to override defaults or configure an external service. Keep secrets out of source control.

The frontend's optional settings are documented in [`frontend/.env.example`](frontend/.env.example). For local development, Vite proxies `/api` requests to the backend, so `VITE_API_BASE` can remain empty.

For the model-backed assistant, set `GROQ_API_KEY` or `ANTHROPIC_API_KEY` in the backend environment. The default provider selection (`WAYMARK_LLM_PROVIDER=auto`) uses Groq when its key is set, otherwise Anthropic when its key is set, and otherwise the rule-based fallback. The default Groq model is `openai/gpt-oss-120b`.

### 4. Start the application

Start the backend from the project root in one terminal:

```bash
uvicorn backend.main:app --reload
```

The API is available at <http://127.0.0.1:8000>. Interactive API documentation is at <http://127.0.0.1:8000/docs>.

Start the frontend in a second terminal:

```bash
cd frontend
npm run dev
```

Open <http://localhost:5173>. Main routes include `/` (landing page), `/map`, `/evidence`, `/data-quality`, `/audit-list`, `/about`, `/auth`, and `/region/:regionId`.

For a single-server local run, build the frontend and then run FastAPI:

```bash
cd frontend
npm run build
cd ..
uvicorn backend.main:app
```

When `frontend/dist/` exists, FastAPI serves the built frontend at <http://127.0.0.1:8000> and falls back to the application entry point for client-side routes.

## Application workflows

### Region analysis and recommendations

1. Open the map and select a cell, locality, or grouped H3 region.
2. Choose **Generate analysis report**. The region page opens with the generated report when the request completes.
3. Review the summary, hotspot table, trends, priority issues, and caveats. Download a PDF or JSON copy if needed.
4. Open the Assistant tab. The report is attached when entering from the report flow; users can also attach a report in the chat composer.
5. Ask a question or use a suggested prompt. Recommendation cards can be added to the action plan.

### Measures and evidence

Measures progress through `planned`, `in_progress`, `evidence_submitted`, and `verified` states. Users can add comments and upload evidence images. A planner reviews submitted evidence and approves or rejects it. A user cannot verify a measure they created or whose evidence they uploaded.

| Role label | Permission summary |
| --- | --- |
| City Planner | Create and review measures; approve or reject evidence; use reports and assistant. |
| Road Authorities | Create measures, move measures through implementation, and submit evidence; cannot verify. |
| Traffic Police | Propose measures, comment, and submit evidence; cannot transition or verify measures. |

The role identifiers used by the API are `planner`, `engineer`, and `community`, respectively.

## Risk estimates and interpretation

### Blackspot likelihood

The cell detail view presents the model-estimated likelihood of reaching the project's blackspot definition: at least three crashes in the relevant historical evaluation year. The likelihood is based on the trained model and stored historical features. It is not a real-time forecast, causal statement, or guarantee that a crash will occur.

Confidence reflects the amount of historical information and model stability. In particular, emerging-risk cells can have little history, so their ranking should be interpreted with that uncertainty in mind. A high ranking is a reason to consider human review, not a finding that a location is unsafe.

### What-if scenarios

Night, rain, and low-visibility controls produce illustrative scenario comparisons based on stored model inputs. Results show differences relative to the baseline estimate and should not be described as predictions of future incidents.

### Adjusted risk overlay

The action-plan overlay is computed from the effect weights in `backend/config/effects.json`:

1. Only verified measures contribute credit. Uploaded evidence alone does not change the adjusted estimate.
2. Credits from multiple verified measures combine multiplicatively and are capped by `credit_cap`.
3. The adjusted cell score is the base score multiplied by one minus its credit. The adjusted region index is the mean of adjusted cell scores.
4. This is an overlay estimate, not a new execution of the risk model.

All current effect weights and stage factors are flagged as placeholders. Adjusted values are illustrative until a road-safety domain owner validates the weights and changes the placeholder flags in `backend/config/effects.json`. The interface and generated reports surface this limitation.

## Data and model pipeline

The project uses the US Accidents dataset (2016–2023), attributed to Sobhan Moosavi and collaborators. The checked-in database and scored outputs are prebuilt project artifacts; the raw source CSV is not included in this repository snapshot. Confirm licensing and data provenance before redistribution or operational use.

The pipeline has separate stages:

1. **Score cells:** `blackspot_pipeline.py` processes a source CSV, engineers features, trains the cell risk model, and writes scores, features, metrics, and model artifacts under `out/`.
2. **Validate input data:** `python pipeline/validate_data.py --csv <path-to-csv>` writes data-quality results and, by default, updates the quality tables in the selected database.
3. **Export app tables:** `python pipeline/export_results.py --csv <path-to-csv>` builds database-ready CSVs under `out/export/` and evaluation outputs.
4. **Build the database:** `python pipeline/load_db.py` creates `waymark.db` from the exported tables. It refuses to overwrite an existing database unless `--force` is supplied.
5. **Load crash locations (optional):** `python pipeline/load_crashes.py --csv <path-to-csv>` populates crash-level map points for available scored cells.
6. **Refresh evidence-backed advice (optional):** `python pipeline/rebuild_advice.py` updates stored factors and recommendations from the saved model, features, and crash records; it does not retrain the main model.
7. **Refresh API contracts (optional):** `python pipeline/make_contracts.py` regenerates the sample report and OpenAPI snapshot from the current application and database.

`pipeline/` scripts accept command-line options; use `--help` to review the current interface before running them.

### Database and file safety

`waymark.db` is required to serve the supplied app. Back it up together with the `data/` directory, which stores evidence images and generated report PDFs. Both can contain persistent project or user data.

`python pipeline/load_db.py --force` deletes and rebuilds the entire target database. This removes operational tables as well as scored data, including accounts, measures, evidence records, reports, and chat history. Do not use it to refresh advice; use `pipeline/rebuild_advice.py` for that narrower update. The advice script creates `waymark.db.before_advice` if the backup does not already exist.

Uploaded images are re-encoded before storage to remove embedded metadata and hidden payloads. The backend may inspect image metadata before re-encoding to assess evidence location and age. The browser only downsizes large images so that useful capture metadata is retained for this check.

## Configuration reference

Backend settings can be supplied as environment variables or in the root `.env` file. Values shown below are the defaults in the current code.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WAYMARK_DB` | `waymark.db` in the project root | SQLite database path. |
| `WAYMARK_DATA_DIR` | `data` | Directory for evidence images and generated report files. |
| `WAYMARK_JWT_SECRET` | Random value per server start | Signs login tokens. Set a stable secret so sessions survive restarts. |
| `WAYMARK_JWT_TTL_MIN` | `480` | Login-token lifetime in minutes. |
| `WAYMARK_DEMO_MODE` | `1` | Enables the demo login endpoint. Set to `0` to disable it. |
| `WAYMARK_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated browser origins allowed by the API. The legacy `WAYMARK_CORS` name is also accepted. |
| `WAYMARK_MAX_UPLOAD_MB` | `10` | Maximum accepted evidence image size in megabytes. |
| `WAYMARK_UPLOAD_RATE_PER_MIN` | `10` | Per-user upload rate limit per minute. |
| `WAYMARK_MAX_REPORT_CELLS` | `5000` | Maximum number of cells in one region report. |
| `WAYMARK_GEO_FAR_KM` | `1.0` | Distance beyond which an evidence photo is flagged as far from covered cells. |
| `WAYMARK_STALE_PHOTO_DAYS` | `30` | Age after which an evidence photo is flagged as old. |
| `WAYMARK_LLM_PROVIDER` | `auto` | Assistant provider: `groq`, `anthropic`, or `auto`. |
| `GROQ_API_KEY` | Unset | Groq credential; keep server-side and private. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Groq model ID. |
| `ANTHROPIC_API_KEY` | Unset | Optional Anthropic credential. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Anthropic model ID. |
| `WAYMARK_CHAT_MAX_TOKENS` | `1500` | Maximum assistant response tokens. |

Frontend variables are documented in [`frontend/.env.example`](frontend/.env.example). They include the API base URL, Vite proxy target, optional MapTiler configuration, mock mode, and the standalone page's WAYMARK application URL.

## Demo accounts

The bundled demo accounts are for local development and demonstration only. Their passwords are public in this repository and must be changed before any deployment exposed to other users.

| Username | Password | Role |
| --- | --- | --- |
| `planner` | `waymark-planner` | City Planner |
| `engineer` | `waymark-engineer` | Road Authorities |
| `community` | `waymark-community` | Traffic Police |

With demo mode enabled, `POST /api/auth/demo` can issue a token for a role without requiring a password. Demo account records are in `backend/config/demo_users.json`. Password hashes can be generated with `python -m backend.auth hash <password>`.

## API overview

FastAPI serves interactive OpenAPI documentation at `/docs` and the OpenAPI schema at `/openapi.json`. Main endpoint groups include:

| Area | Routes |
| --- | --- |
| Health and summary | `GET /api/health`, `GET /api/summary` |
| Cells and crashes | `GET /api/cells`, `GET /api/cells/{cell_id}`, `GET /api/crashes` |
| Places and regions | `GET /api/places`, `GET /api/regions/resolve` |
| Scenarios and validation | `GET /api/whatif`, `GET /api/validation`, `GET /api/metrics` |
| Audit list | `GET /api/audit-list` (supports CSV format) |
| Authentication | `POST /api/auth/login`, `POST /api/auth/signup`, `POST /api/auth/demo` |
| Reports | `POST /api/reports`, `GET /api/reports`, report status and PDF/JSON download routes |
| Measures and evidence | `/api/measures`, `/api/evidence`, `/api/effects`, and region progress routes |
| Assistant | `/api/chat/sessions` and session report/message routes |

Operational report, measure, evidence, and assistant routes require authentication. Permissions depend on the user's role. See the OpenAPI document for request and response schemas.

## Development checks

Run these commands from the project root unless noted:

```bash
python -m pytest
cd frontend
npx tsc -b
npm run lint
npm run build
```

The frontend build runs the TypeScript project build before bundling with Vite. `npm run lint` invokes Oxlint. The backend tests use the local application and mocked external model clients; they do not require a live assistant API key.

## Deployment

The intended deployment separates the static React application on Vercel from the FastAPI service on Render. The frontend calls the backend directly in production, so configure the frontend API URL and the backend CORS allowlist to match each other.

### Deploy the backend to Render

Create a Render **Web Service** connected to the repository. Use the repository root as the service root directory and configure:

| Setting | Value |
| --- | --- |
| Runtime | Python |
| Build command | `pip install -r requirements.txt` |
| Start command | See the persistent-storage command below. |
| Health check path | `/api/health` |

The supplied app uses SQLite and writes evidence images and generated reports to local disk. Render's default filesystem is ephemeral, so operational changes and uploaded files can be lost on restart or deployment. For persistent storage, attach a Render disk mounted at `/var/data`, then set these environment variables:

```text
WAYMARK_DB=/var/data/waymark.db
WAYMARK_DATA_DIR=/var/data/data
```

Use this start command to seed the persistent database from the checked-in `waymark.db` only when the disk does not already contain a database, then start the API on Render's assigned port:

```sh
sh -c 'mkdir -p "$WAYMARK_DATA_DIR"; if [ ! -f "$WAYMARK_DB" ]; then cp waymark.db "$WAYMARK_DB"; fi; exec uvicorn backend.main:app --host 0.0.0.0 --port "$PORT"'
```

Do not run `pipeline/load_db.py --force` as a deploy command. It rebuilds the database and deletes operational data. A Render disk is attached to one service instance; this SQLite deployment is intended for a single backend instance. Back up the database and the `data/` files regularly. See Render's [FastAPI deployment guide](https://render.com/docs/deploy-fastapi) and [persistent disk documentation](https://render.com/docs/disks).

Configure the following in the Render service dashboard. Set `WAYMARK_CORS_ORIGINS` to the exact production Vercel origin, such as `https://waymark.example`, without a trailing slash. Add preview origins only if they are needed.

```text
WAYMARK_CORS_ORIGINS=https://<your-vercel-domain>
WAYMARK_JWT_SECRET=<a-long-random-secret>
WAYMARK_DEMO_MODE=0
```

Also set any required assistant provider variables, such as `WAYMARK_LLM_PROVIDER=groq` and `GROQ_API_KEY`. Configure secrets in Render's environment settings; do not commit them. Replace bundled demo passwords before enabling accounts for real users. The Render filesystem, persistent disk behavior, and available plans may change; consult the current [Render Web Service](https://render.com/docs/web-services) and [disk limitations](https://render.com/docs/disks) documentation.

### Deploy the frontend to Vercel

Create a Vercel project from the same repository and set:

| Setting | Value |
| --- | --- |
| Root directory | `frontend` |
| Framework preset | Vite |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |

In Vercel's project environment variables, set `VITE_API_BASE` to the Render service's public origin, for example `https://waymark-api.onrender.com`. Do not add `/api`; the frontend adds API route paths itself. Vite embeds `VITE_*` values at build time, so redeploy after changing this value. Never put `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, JWT secrets, or other server credentials in Vercel frontend variables.

This application uses React Router client-side routes. Add `frontend/vercel.json` with the following SPA rewrite so direct links and page refreshes resolve to the application entry point:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

Configure the Vercel production domain in Render's `WAYMARK_CORS_ORIGINS`. If using preview deployments, add their exact origins as appropriate. Vercel's current [Vite deployment guide](https://vercel.com/docs/frameworks/frontend/vite) describes SPA rewrites and project settings.

### Post-deployment checks

1. Open the Render health endpoint: `https://<render-service>.onrender.com/api/health`.
2. Open the Vercel root, then refresh a nested route such as `/map` or `/region/<region-id>`.
3. Confirm the map and summary load, and verify browser requests reach the Render API without CORS errors.
4. Sign in using the configured authentication flow, create a test report, and verify it persists after a backend restart.
5. Upload a test evidence image and verify the file remains available after a backend restart.
6. Confirm the assistant uses the configured provider or presents its fallback state when no provider key is configured.

Before using the deployment with real users, use a stable JWT secret, disable demo login, replace demo credentials, validate intervention effect weights, review map tile usage terms, and configure backups and upload size limits. Persistent local files support a modest single-instance deployment; for multi-instance or higher-availability production, migrate the database and uploaded objects to shared managed services.

## Limitations and responsible use

- WAYMARK is a prototype for decision support, not an automated audit or enforcement system.
- The supplied results are specific to one city and one dataset/backtest context. Performance may not transfer to other regions, time periods, or reporting conditions.
- Crash records are subject to under-reporting, recording practices, missing fields, and time-period discontinuities. Data-quality warnings should be reviewed before interpreting model results.
- Historical associations do not establish that a feature caused crashes or that a proposed measure will reduce them.
- Low-history cells carry greater uncertainty. Use the confidence and caveat information alongside the ranking.
- Effect weights for the adjusted estimate are placeholders until reviewed by a qualified domain owner.
- The assistant provides suggestions for review and can fall back to deterministic rule-based responses. It is not a source of engineering, legal, or safety certification.

## Attribution

The source crash dataset is US Accidents (2016–2023), collected and published by Sobhan Moosavi and collaborators. OpenStreetMap and optional map-tile providers supply the underlying map imagery. Respect the applicable data and tile-provider terms when redistributing or deploying this application.
