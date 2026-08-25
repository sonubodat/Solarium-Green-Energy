# Solarium Frontend

React frontend for the public referral flow and the Admin, Sales, and Vendor portals. All four are connected to the live backend API — see `../docs/progress.md` for exactly which flows and mutation controls are implemented in each.

## Setup

Run `npm install`, then `npm start`. The frontend runs on port `3000`. For local development, leave `REACT_APP_API_BASE_URL` unset — `src/setupProxy.js` makes the CRA dev server forward `/api/*` calls to the backend on port `4000`. This works both at plain `localhost` and when the frontend is opened through a tunnel (ngrok, etc.) from another device, including full-page navigations to a server-rendered `/api` endpoint (e.g. the Admin QR print sheet), not just `fetch()`/XHR calls — deliberately not using package.json's simpler `"proxy"` field, since that only forwards requests whose `Accept` header excludes `text/html` and silently breaks that print-sheet case. A hardcoded `http://localhost:4000/api` only works when the browser itself is on this machine, and otherwise fails with a CORS error and/or the browser's "local network access" permission prompt (the browser refusing to let a public origin reach a private-network address). Only set `REACT_APP_API_BASE_URL` (see `.env.example`) when the frontend and backend are deployed to genuinely separate domains.

The single-page `View as` switcher in `src/App.js` is the whole app for now — Public, Vendor, Sales, and Admin each render in place rather than as separate routes. Role boundaries and mutation authorization are enforced by the backend regardless of what the UI shows; see `../docs/api.md` and `../docs/architecture.md` for the contract, and `../docs/testing.md` for the walkthrough used to verify each portal.
