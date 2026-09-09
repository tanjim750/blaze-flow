# Blaze Flow Frontend Guide

This describes the Next.js application in `frontend/`, which is the browser client for the
Django API documented in `docs/DEVELOPMENT.md`. Keep it current whenever a route, data
loader, or backend coupling changes. Material work belongs in `docs/implementation-log.md`.

## Current state

The frontend is an authenticated vertical slice, not a finished product. Eight routes exist
and each is wired to real API data:

| Route | Kind | Purpose |
| --- | --- | --- |
| `/` | Server component | Workspace dashboard: stats, tasks, review queue, projects, deadlines, activity |
| `/projects` | Server component + client browser | Client → campaign → asset tree, asset grid/list, and a workflow status board |
| `/review` | Server component + client workspace | Proxy video player with timecoded comments, replies, and resolution |
| `/sign-in` | Client component | Email/password session login |
| `/sign-up` | Client component | Registration, followed by an automatic sign-in |
| `/forgot-password` | Client component | Requests a reset email |
| `/reset-password` | Server component + client form | Consumes a reset token from the emailed link |
| `/verify-email` | Server component + client panel | Consumes a verification token, or resends one |

The last five share the split-screen shell in `src/app/(auth)/layout.tsx`. `(auth)` is a
route group, so it adds no path segment — those pages stay at their top-level paths.

Everything the sidebar and topbar link to beyond those routes (`/tasks`, `/files`,
`/clients`, `/team`, `/render-queue`, `/deliverables`, `/settings`, `/help`) is navigation
scaffolding pointing at routes that do not exist yet and will 404.

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 App Router, React 19 |
| Language | TypeScript, `strict` |
| Icons | `lucide-react` |
| Styling | Plain CSS files imported per route, on a small Tailwind v4 base |
| Fonts | `next/font` Geist Sans and Geist Mono |
| State | Server components for data; `useState`/`useActionState` for local interaction only |

There is no client-side data-fetching library, no global store, and no component library.
Every page renders from data the server already resolved.

## Running it

The Django API must be running first, because every page loads through it.

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server on port 3000 |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint (`eslint-config-next`) |
| `npx tsc --noEmit` | Type check |

| Variable | Required | Meaning |
| --- | --- | --- |
| `BLAZEFLOW_API_URL` | No | Django origin; defaults to `http://127.0.0.1:8000` |

`BLAZEFLOW_API_URL` is read in two places and both must agree: `next.config.ts` for the
browser-facing rewrite, and `src/lib/api.ts` for server-side fetches.

`predev` deletes stray `._*` files from `.next` before starting. That exists only because
this checkout has lived on an external volume that creates macOS AppleDouble metadata; see
the external-drive warning in `docs/DEVELOPMENT.md`.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/app/layout.tsx` | Root layout, fonts, document metadata |
| `src/app/page.tsx` | Dashboard route |
| `src/app/projects/` | Projects route: `page.tsx`, `browser.tsx` (client), `actions.ts` |
| `src/app/review/` | Review route: `page.tsx`, `workspace.tsx` (client), `actions.ts` |
| `src/app/(auth)/` | Pre-session pages and their shared layout, styles, and forms |
| `src/app/actions.ts` | `signOutAction`, the one app-wide server action |
| `src/components/app-shell.tsx` | Sidebar, topbar, workspace tabs, and the account menu |
| `src/components/dashboard-tasks.tsx` | Task panel with Today/Upcoming/Overdue buckets |
| `src/lib/api.ts` | Typed server-side Django client; the only place a URL is built |
| `src/lib/session.ts` | Resolves the current user and decides the unauthenticated path |
| `src/lib/auth-client.ts` | Browser-side client for the public auth endpoints |
| `src/lib/errors.ts` | Turns a DRF error body into one sentence; used by both clients |
| `src/lib/user.ts` | Name and initials helpers, importable from client components |
| `src/lib/dashboard-view.ts` | Builds the dashboard view model |
| `src/lib/projects-view.ts` | Builds the projects tree, asset cards, and status board |
| `src/lib/review-view.ts` | Builds the review view model and nests comment replies |
| `src/lib/timecode.ts` | `mm:ss` formatting, importable from client components |
| `src/app/*.css` | `globals.css` tokens and reset, `shell.css` chrome, `forms.css` errors |
| `src/app/*/*.css` | Per-route styles (`home.css`, `projects.css`, `review.css`) |
| `public/images/` | Demo-fallback thumbnails only; not product assets |

## Architecture

Three layers, and the boundaries are deliberate:

1. **API client** (`src/lib/api.ts`) — one typed function per endpoint. It returns
   `ApiResult<T>`, a discriminated union of `{ok: true, data}` and
   `{ok: false, error: {status, detail}}`. It never throws, so a caller must handle
   failure explicitly. It imports `next/headers` and is therefore server-only.
2. **View models** (`src/lib/*-view.ts`) — async loaders that call several endpoints and
   flatten the results into exactly the shape a page renders: labels, tones, relative
   ages, buckets. All date and status formatting happens here, not in JSX.
3. **Routes and components** — server components await a loader and render. Client
   components receive the finished view model as props and own only interaction state
   (which tab, which bucket, player position, reply target).

Writes go through server actions (`actions.ts`) rather than browser `fetch`, so mutations
run with the session cookie already available and finish with `revalidatePath` instead of
manual cache invalidation.

The exception is the pre-session auth forms, which post from the browser through
`src/lib/auth-client.ts`. Login has to: only a response the browser itself handles can
accept Django's `Set-Cookie`. The other public auth endpoints follow it for consistency and
inline validation feedback. Both clients render failures through the same
`describeErrorBody`, so a DRF field error such as `{"password": ["This password is too
short."]}` reads as "Password: This password is too short." wherever it surfaced rather than
as raw JSON.

## How requests reach Django

There are two distinct paths, and the difference matters:

- **Server-side** (`src/lib/api.ts`) fetches `BLAZEFLOW_API_URL` directly, so a server
  component never issues a request back into its own server. It forwards the browser's
  entire cookie jar verbatim and adds `X-CSRFToken` from the `csrftoken` cookie for unsafe
  methods. Every request uses `cache: "no-store"`.
- **Browser-side** requests go to relative `/api/*` paths, which `next.config.ts` rewrites
  to Django. This keeps the session cookie same-origin. It covers the login POST and the
  `<video>` element's proxy stream.

The rewrite carries two non-obvious workarounds, both for trailing slashes. Django's
`APPEND_SLASH` means every API route ends in `/`. Next answers `/api/auth/login/` with a
308 to the slashless path, which Django 301s straight back — an infinite redirect. So
`skipTrailingSlashRedirect: true` drops Next's 308, and the rewrite destination re-appends
the slash that Next strips out of `:path*`. Both are unconditional because all current API
routes end in a slash.

## Authentication

Django uses session authentication, so the frontend holds no token and stores nothing.

`loadSession()` calls `GET /api/auth/me/` and separates two failure modes on purpose:

- **401 or 403** — the API answered and said no. There is nothing useful to render, so the
  page redirects to `/sign-in`.
- **Status 0** — Django is unreachable. Redirecting would assert something we cannot know,
  so the page keeps rendering and surfaces a notice instead.

### Signing in and out

`/sign-in` posts to `/api/auth/login/` with `credentials: "include"`, then calls
`router.push("/")` and `router.refresh()` so the new session is picked up on the server.

Sign-out lives in the topbar account menu and submits a form to `signOutAction`
(`src/app/actions.ts`). Django's `logout()` flushes the session row, but a server-side
fetch's `Set-Cookie` never reaches the browser, so the action also deletes `sessionid` and
`csrftoken` from the jar. Without that the browser keeps sending a dead cookie and every
page costs an API round trip to discover it is signed out. The API call is best-effort: if
it fails, clearing the cookies and leaving is still the right outcome for someone who asked
to sign out.

`/auth/logout/` and `/auth/password/change/` are session-authenticated and therefore
CSRF-enforced, which is why they run server-side through `lib/api` — `authHeaders()`
supplies `X-CSRFToken` from the cookie. Every other auth endpoint is declared
`@authentication_classes([])` on the Django side and needs no token.

### Registration

`/sign-up` makes two calls, because Django's register endpoint creates the account without
opening a session: register, then sign in with the same credentials. It sends the browser's
IANA timezone so the account starts in the right one. If registration succeeds but the
follow-up sign-in fails, the page says so explicitly rather than implying the account was
not created.

Registration also triggers a verification email. Verification is an account signal — it
does not block login, but it does gate workspace creation.

### Reset and verification links

Django builds both emails against frontend URLs — `PASSWORD_RESET_URL` and
`EMAIL_VERIFICATION_URL`, defaulting to `/reset-password` and `/verify-email` with the raw
token as a `?token=` query parameter. Both pages are server components that read the token
from `searchParams` and hand it to a client form, so the token never round-trips through
browser history state.

Two deliberate behaviours:

- **Verification requires a click.** The page does not confirm on load. Tokens are
  single-use, and mail clients and link scanners routinely prefetch URLs — an automatic
  confirm would let a prefetch burn the token before the recipient ever saw the page.
- **Reset and resend messages never confirm whether an account exists.** Both endpoints
  answer 202 either way for enumeration safety, so the UI repeats that hedge ("if an active
  account exists") rather than asserting an email was sent.

Both pages handle a missing token — a link truncated by a mail client, or pasted without
its query string — with an explanation and a route back to requesting a new one.

## The demo-fallback convention

Every view loader has a demo path. When the API cannot answer — unreachable, no workspace
on the account, or an error status — the loader returns realistic placeholder content
drawn from the Stitch design references plus a human-readable `notice`, and the page
renders a warning banner above otherwise normal content.

This is what makes the UI reviewable with no backend running, which is why it exists. It
also means **a page showing content is not proof the API works**; check for the banner, or
for "Demo content" in the Projects tab strip. Demo content is confined to the `demoView`
functions and `DEMO_VIEW` in `src/lib/*-view.ts`; nothing else fabricates data.

The distinction the loaders maintain: a demo notice means the API failed, whereas a real
signed-in account with no data returns a genuine empty state and no notice.

## Pages

### Dashboard (`/`)

The backend has no dashboard or summary endpoint, so everything is derived client-of-API
side from three workspace-wide lists — projects, tasks, notifications — plus a fan-out for
media versions bounded to the first `REVIEW_SCAN_LIMIT` (6) projects, which caps request
count on a large workspace.

Derivations worth knowing: tasks bucket into Today/Upcoming/Overdue from `due_at` against
local midnight; project completion percentage is that project's completed tasks over its
non-cancelled tasks; a cut counts as awaiting review when its workflow stage name contains
"review" or "approv"; recent activity is rendered from the notification feed. A task-list
failure is not fatal — the projects half of the page still renders.

### Projects (`/projects`)

Selection is URL state: `?client=`, `?campaign=`, `?tab=`, and `?view=list`, so any view is
linkable and the server can resolve it before render. Falls back left to right — the
requested id, else the first client that has campaigns, else the first client.

The Assets tab renders media versions as cards or a dense list, filtered by a client-side
search over title, note, and stage. The Status tab groups the same media into one column
per active workflow stage, with an extra "Unstaged" column for versions that have no open
stage. Stage names are mapped onto the mockup's badge palette by keyword (`toneFor`,
`columnTone`), so a workspace with custom stage names still colors sensibly.

Three server actions write: create client team, create campaign, create folder.

### Review (`/review`)

Loads a project's media versions, selects a cut, and loads its comments. Selection falls
back from the requested version, to the newest cut in the requested project, to the first
project in the workspace that actually has media — that last step matters because most
projects have no uploads and landing on an empty viewer looks broken.

The player streams the H.264 proxy from the media-version `preview/` endpoint through the
rewrite. A 404 is expected while the worker is still transcoding, so `onError` swaps in a
placeholder that says so rather than failing silently.

Comments are flattened from the API's parent/child rows into nested notes; a reply whose
parent is missing is promoted to top level rather than dropped. Open comments appear as
markers on the scrubber and seek the player when clicked. The composer forwards the
player's current position as `start_time_ms` so a note pins to a timecode; replies never
send timing, because the backend rejects it on a reply. Resolve/reopen requires
`REVIEW_COMMENT_MANAGE`, and `canComment` is inferred from whether the comment list
returned successfully — a 403 there means read access without comment rights.

## Backend gaps that shape the UI

These are backend limitations the frontend works around. Each is a place where a schema or
endpoint change would let the UI get simpler, not just prettier.

| Gap | Current workaround |
| --- | --- |
| No `Project.client_team` relation | Client → campaign grouping is stored in `ClientTeam.metadata.project_ids`. Creating a campaign is therefore two writes; if the second fails the project shows under "Unassigned" rather than being lost. |
| No dashboard/summary endpoint | Dashboard derives everything from list endpoints plus a bounded media fan-out |
| Media list serializer has no poster frame | Asset and review cards fall back to a tinted plate |
| No comment count, duration, or resolution on the media list | Those fields are `null` and the card omits them rather than faking a number |
| No task completion endpoint | The dashboard checkbox is session-local and does not write back |
| Comment lists are offset-paginated via `X-Pagination-*` headers | The review page requests one page of `limit=200` and does not paginate |

## Styling

`globals.css` holds the dark palette as CSS custom properties on `:root` and imports
`forms.css` and `shell.css`; route styles are imported by the route that uses them. Tailwind
v4 is present as a base layer, but layout is written as plain CSS with semantic class names
matching the Stitch references (`studio-*` for chrome, `pb-*` for the projects browser,
`rv-*` for review). Follow the existing convention in a file rather than mixing utility
classes into it.

Interactive elements carry `aria-current`, `aria-pressed`, `aria-selected`, `aria-label`,
and `role="progressbar"` where the visual affordance alone is not enough. Keep that up.

The design references live in `stitch_blaze_flow_creative_operating_system/` (not committed)
and the palette notes in that directory's `precision_dark_media_os/DESIGN.md`.

## Known limitations

- No tests of any kind. `tsc --noEmit` and `npm run lint` are the only automated checks.
- Eight navigation targets 404 (listed under Current state).
- **A new account lands on demo content.** Sign-up works, but the account owns no
  workspace, so every loader's `workspaces[0]` is undefined and the dashboard falls back to
  demo content behind a notice. There is no create-workspace flow yet, which makes this the
  most visible gap in the product.
- Inert controls that render but do nothing: "+ Upload Asset", "Client Review Link", the
  Format/Status/sort filter dropdowns, per-card menus, "Approve" on a review, and "Continue
  with Google". The Google button needs a client id and the GIS handshake; the API half
  (`POST /api/auth/google/`) already exists.
- No authenticated account management — no password change, no profile edit, no
  verification resend from inside the app. `/settings` in the account menu 404s.
- No workspace switcher — every loader takes `workspaces[0]`. An account with more than one
  workspace can only ever see the first.
- Annotations, reactions, attachments, guest review access, notifications management, and
  workflow transitions are all supported by the API and absent from the UI.
- `PRO` in the sidebar and the render-engine status block are static decoration, not real
  subscription or worker state.
- The dashboard task checkbox does not persist.

## Next steps

In rough order of value:

1. A create-workspace flow, including the verified-email gate. Registration currently ends
   on a demo-content dashboard, which is the worst first impression the app can give.
2. An authenticated account area at `/settings`: password change, profile, and verification
   resend. The endpoints exist and the account menu already links there.
3. Asset upload from the Projects page, which is the largest missing product action.
4. A real `Project.client_team` foreign key, replacing the `metadata.project_ids` workaround
   and its two-write campaign creation.
5. Workflow transitions and approval from the review page.
6. Google sign-in: a `NEXT_PUBLIC_` client id and the GIS handshake against the existing
   `POST /api/auth/google/`.
7. A component test setup, so the view-model derivations get covered.
