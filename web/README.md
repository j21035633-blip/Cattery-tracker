# Cattery Tracker — Web

Next.js 15 (App Router) + React 19 + Tailwind. Responsive for desktop and
tablet; the same layouts hold up on a phone browser.

## Quick start

```bash
npm install
cp .env.example .env.local     # point NEXT_PUBLIC_API_URL at the backend
npm run dev                    # http://localhost:3000
```

The backend must be running (`uvicorn app.main:app --reload` in `../backend`)
and must list this origin in `CORS_ORIGINS`.

```bash
npm run build        # production build
npm run start        # serve the build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
```

## Layout

```
src/
  app/
    (auth)/login, (auth)/signup   unauthenticated pages
    (app)/…                       everything behind the auth guard
      dashboard   what's due today, one-tap complete
      cats        list + detail (weight chart, schedules, vet records)
      feeding     schedules and today's feedings
      cleaning    rotation tasks grouped by zone
      vet         appointments, vaccinations, medication
      notifications  notification centre + digest preview
      settings    profile, digest time, per-task-type thresholds
  components/     ui.tsx primitives, weight-chart.tsx
  lib/            api client, auth context, formatting
```

## Responsive behaviour

One breakpoint set, defined in `tailwind.config.ts`:

- `tablet` (768px) — two-column cards, side-by-side form fields.
- `desktop` (1180px) — persistent left sidebar replaces the bottom tab bar.

Below `desktop` the shell uses a sticky top bar plus a bottom tab bar with a
safe-area inset, which is what a tablet held in one hand wants. Tap targets are
raised to 44px on coarse pointers.

## Auth

`src/lib/auth-context.tsx` restores the session from `localStorage` on first
paint and exposes `login` / `signup` / `logout`. Pages under `(app)` redirect to
`/login` when there is no session.

`src/lib/api.ts` handles token rotation: on a 401 it refreshes once and replays
the request. Concurrent 401s share one refresh — the backend rotates refresh
tokens single-use, so six parallel refreshes would leave five rejected.

Tokens live in `localStorage` rather than a cookie because the API is a separate
origin using bearer auth, the same contract the Expo app uses, and no page does
server-side data fetching that would need the token on the server.

## Talking to the API

Every call goes through the typed `api` object. `src/lib/types.ts` mirrors the
FastAPI response schemas — update both together when an endpoint changes.

Tenant isolation is enforced by the backend; the client never sends a `user_id`.
A row belonging to another account returns 404, so the UI shows "not found"
rather than a permission error.

## Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | yes | `http://localhost:8000` | Base URL of the backend, no trailing slash |

## Deploying to Railway

Root directory `web`, build `npm run build`, start `npm run start` (it reads
`$PORT`). Set `NEXT_PUBLIC_API_URL` to the deployed backend URL, and add the web
service's URL to the backend's `CORS_ORIGINS`.

`NEXT_PUBLIC_*` values are inlined at build time, so changing the API URL needs
a rebuild, not just a restart.

## Not built yet

- Editing a cat's details from the detail page (create, retire and delete are
  there; field edits still go through the API).
- Cleaning history view — the events are recorded and the endpoint exists
  (`/cleaning-events`), but nothing renders them yet.
- Feeding history beyond today.
