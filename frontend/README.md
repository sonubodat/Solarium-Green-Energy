# Solarium Frontend

React frontend for the public referral flow and the Admin, Sales, and Vendor portals. All four are connected to the live backend API — see `../docs/progress.md` for exactly which flows and mutation controls are implemented in each.

## Setup

Run `npm install`, then `npm start`. The frontend runs on port `3000` and uses `REACT_APP_API_BASE_URL` to call the backend on port `4000`.

For local development, create `.env.local` from `.env.example`:

```text
REACT_APP_API_BASE_URL=http://localhost:4000/api
```

The single-page `View as` switcher in `src/App.js` is the whole app for now — Public, Vendor, Sales, and Admin each render in place rather than as separate routes. Role boundaries and mutation authorization are enforced by the backend regardless of what the UI shows; see `../docs/api.md` and `../docs/architecture.md` for the contract, and `../docs/testing.md` for the walkthrough used to verify each portal.
