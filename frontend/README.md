# Blaze Flow Frontend

The Next.js browser client for the Blaze Flow Django API.

**Full documentation: [`../docs/frontend.md`](../docs/frontend.md)** — architecture, routes,
API coupling, backend gaps, and known limitations. Read it before changing a data loader.

## Quick start

The Django API must be running first, because every page loads through it. From the
repository root, `docker compose up --build`, then:

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

Sign in at `/sign-in` with an account that exists in the API. With no API reachable, the
pages still render placeholder content behind a warning banner — see the demo-fallback
convention in the full documentation.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server on port 3000 |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type check |

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `BLAZEFLOW_API_URL` | No | Django origin; defaults to `http://127.0.0.1:8000` |

Set it for both the server-side client and the `/api/*` rewrite — they read the same
variable, in `src/lib/api.ts` and `next.config.ts` respectively.

## Layout

```
src/app/          routes: / (dashboard), /projects, /review, /sign-in
src/components/   app shell and shared panels
src/lib/          typed API client, session, and per-page view models
```

Data is loaded in server components through `src/lib/*-view.ts`; writes go through server
actions in each route's `actions.ts`. Client components receive finished view models and
own interaction state only.
