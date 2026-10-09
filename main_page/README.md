# WAYMARK Product Landing Page

`main_page/` contains the standalone source for WAYMARK's original product landing page and interactive story. It is maintained as an independent frontend alongside the primary application in `frontend/`.

The landing page explains the road-safety prioritization problem, the model evidence and its limitations, and the intended workflow for road authorities, city planners, and traffic police. Its interactive map and displayed metrics use the snapshot embedded in `src/data/engine.ts`; they do not read from the live WAYMARK database or API.

## Technology

- React 19, TypeScript, Vite, and Tailwind CSS v4
- GSAP with ScrollTrigger and Lenis for scroll-based storytelling
- Framer Motion for component transitions
- Leaflet for the illustrative map
- Firebase Authentication for email/password and Google sign-in
- Vite single-file plugin for the standalone production bundle

Exact versions are recorded in `package.json` and `package-lock.json`.

## Local development

From this directory, install dependencies and start the development server:

```bash
npm install
npm run dev
```

The page runs at <http://localhost:5174>. The preview server runs on port 4174 after building:

```bash
npm run build
npm run preview
```

`npm run build` writes the generated site to `dist/`. The Vite single-file plugin bundles the frontend assets into the HTML output for a standalone handoff.

## Application links

The landing page's workspace, map, login, and signup links open the primary WAYMARK application. Set `VITE_WAYMARK_APP_URL` in `.env.local` to the deployed application URL. The default is `http://localhost:5173`.

Create `.env.local` by copying `.env.example` and changing the URL if needed:

```dotenv
VITE_WAYMARK_APP_URL=http://localhost:5173
```

Do not include backend Groq or Anthropic credentials in this frontend environment.

## Authentication

The standalone page uses Firebase Authentication for email/password and Google sign-in. After authentication, users select a role for the page's workspace experience. Firebase project configuration is in `src/lib/firebase.ts`; configure authorized domains and authentication providers in the associated Firebase project before deploying to a new domain.

This authentication flow is separate from the primary application's FastAPI authentication and account database. The landing-page demonstration should not be treated as synchronized with backend roles or permissions.

## Embedded data and methodology content

`src/data/engine.ts` is the source for the landing page's displayed metrics, illustrative cell scores, SHAP factor examples, scenario deltas, and suggested actions. Updating a value there updates the sections and interactive map that import it. These values are a bundled snapshot for the standalone experience; they do not change when `waymark.db` is updated.

The story describes a Houston-focused backtest and blackspot definition. It also presents the project's intended safeguards: treat scores as estimates, communicate uncertainty, avoid causal claims, and make human experts responsible for decisions. Review source data, split periods, and caveats before changing the public-facing metrics or methodology statements.

## Key source areas

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | Page composition, navigation state, and top-level experience. |
| `src/sections/` | Product-story sections, evidence summary, limits, calls to action, authentication views, and role workspaces. |
| `src/components/` | Navigation, map, motion, and reusable interface components. |
| `src/data/engine.ts` | Embedded metrics and illustrative cell data. |
| `src/data/roles.ts` | Role labels, descriptions, and workspace metadata. |
| `src/lib/appUrl.ts` | URL construction for links to the primary WAYMARK app. |
| `src/lib/auth.ts` and `src/lib/firebase.ts` | Firebase authentication wrappers and initialization. |

## Deployment considerations

- Set `VITE_WAYMARK_APP_URL` before building so links point to the intended primary application.
- Add the deployed hostname to Firebase Authentication's authorized domains and configure the required sign-in methods.
- The map uses public CartoDB Positron tiles at runtime. A fallback grid is displayed if the tile layer is unavailable; review tile-provider terms and expected traffic for public deployments.
- The page is a Vite static site. Host the generated `dist/` output on a static hosting provider.
- Respect `prefers-reduced-motion`; the experience includes a reduce-motion control for scroll and animation effects.

## Relationship to the primary application

The main application lives in [`../frontend`](../frontend/README.md) and contains the current API-backed map and operational workflows. This directory's source is preserved as a separate standalone copy of the original marketing experience; changes to `frontend/` do not automatically update `main_page/`, and vice versa.
