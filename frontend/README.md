# Solarium Frontend

React frontend boundary for the public referral flow and Admin, Sales, and Vendor portals.

## Setup

Run `npm install`, then `npm start`. The frontend runs on port `3000` and uses `REACT_APP_API_BASE_URL` to call the backend on port `4000`.

For local development, create `.env.local` from `.env.example`:

```text
REACT_APP_API_BASE_URL=http://localhost:4000/api
```

The current screen is only the frontend foundation. Role-specific routes and components are implemented according to `../docs/api.md` and `../docs/architecture.md`.
