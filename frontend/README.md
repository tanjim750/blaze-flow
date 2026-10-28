# Krewsys Frontend

The Next.js browser client for the Krewsys Django API.

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

Create an account at `/sign-up`, or sign in at `/sign-in`. Password reset and email
verification are at `/forgot-password`, `/reset-password`, and `/verify-email`; the last two
are the targets of Django's emailed links, so set `PASSWORD_RESET_URL` and
`EMAIL_VERIFICATION_URL` to this origin.

With no API reachable, the pages still render placeholder content behind a warning banner —
see the demo-fallback convention in the full documentation.

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
| `NEXT_PUBLIC_SITE_URL` | No | Public site URL for canonical links, `sitemap.xml` and Open Graph cards (build time) |

Set it for both the server-side client and the `/api/*` rewrite — they read the same
variable, in `src/lib/api.ts` and `next.config.ts` respectively.

## Layout

```
src/app/          routes: / (dashboard), /projects, /review
src/app/(auth)/   sign-in, sign-up, forgot/reset password, verify email
src/app/(marketing)/  public site: /welcome (served at / when signed out), /features,
                  /pricing, /contact, /privacy, /terms, /cookies
src/components/   app shell and shared panels
src/lib/          typed API client, session, and per-page view models
```

Data is loaded in server components through `src/lib/*-view.ts`; writes go through server
actions in each route's `actions.ts`. Client components receive finished view models and
own interaction state only.

## Public marketing site

Signed-out visitors at `/` get the marketing homepage; signed-in people keep their
dashboard. `src/proxy.ts` decides on the presence of Django's `sessionid` cookie and
rewrites `/` to `/welcome` (the address bar keeps `/`). It matches `/` only, so app routes,
`/platform` and the API never pass through it.

The product name, tagline, contact email, domain and Pro price live in one file,
`src/lib/site-config.ts`. Marketing pages, titles, metadata, `sitemap.xml`, `robots.txt` and
the Open Graph card (`/og.png`) all read from it, and a test fails if a marketing file types
the name out. Screenshots and the hero clip in `public/marketing/` are real captures from
the local demo workspace.

Look and motion: cream paper, ink outlines and poster colours (tomato accent with sun, sky,
mint and pink), Bricolage Grotesque + Caveat via `next/font` (self-hosted at build time),
all scoped under `.mk` in `src/app/(marketing)/marketing.css` so the app keeps its own
theme. The playful pieces (self-drawing scribbles, 3D tilt cards, stickers, spring
entrances) live in `src/components/marketing/playful.tsx`. `motion-prefs.ts` sets the
motion budget: prefers-reduced-motion gets no animation (the demo clip waits on its
poster with a Play button), and small screens, data-saver and low-power devices skip
the continuous scroll-linked effects and keep only one-shot entrances. Tilt only exists
with a real mouse. The OG card's fonts are static TTF instances in `src/app/og.png/fonts/`
(SIL OFL), because the OG renderer can't use variable fonts.
