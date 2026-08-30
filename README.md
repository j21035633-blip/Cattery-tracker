# Cattery Tracker

Multi-tenant cattery management: feeding, litter/cleaning rotation, vet and
vaccination tracking, weight logs, and reminders — across any number of cats,
from any device.

```
backend/   FastAPI + MongoDB (Beanie) API, notification engine, background worker
web/       Next.js web app (desktop + tablet)
mobile/    React Native (Expo) app (phone + tablet, native push via EAS)
```

## Running the whole thing locally

```bash
# 1. Database — either option works
docker compose up -d                              # Docker: MongoDB + admin UI
cd backend && ./scripts/mongo-local.sh            # or no Docker, no admin rights

# 2. API — http://localhost:8000 (docs at /docs)
cd backend
python -m venv .venv && .venv/Scripts/activate   # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env                              # set SECRET_KEY
uvicorn app.main:app --reload

# 3. Notification worker (separate terminal)
cd backend && python -m app.worker

# 4. Web app — http://localhost:3000
cd web
npm install
cp .env.example .env.local
npm run dev

# 5. Mobile app (needs a development build for push — see mobile/README.md)
cd mobile
npm install
cp .env.example .env
npx expo start
```

## Browsing the database

`docker compose up -d` also starts [mongo-express](https://github.com/mongo-express/mongo-express)
at **http://localhost:8082** — collections, documents, indexes, and ad-hoc
queries in the browser.

It is mapped to host port 8082 rather than its default 8081, because Expo's
Metro bundler already uses 8081 (and the backend's `CORS_ORIGINS` lists it), so
the admin UI and the mobile dev server can run at the same time.

If MongoDB is running **natively** (via `backend/scripts/mongo-local.sh`) rather
than in a container, start only the UI and point it at the host — naming the
service matters, or Compose also starts the containerised database:

```bash
docker compose --profile host-mongo up -d mongo-express-host
```

Basic auth is off, since it binds to localhost and holds development data. Set
`ME_CONFIG_BASICAUTH_ENABLED: "true"` and change the credentials before putting
it anywhere reachable.

## What each part does

**Backend** ([details](backend/README.md)) — JWT auth on email + password, with
phone on the account. Every tenant-owned document carries `user_id`, enforced by
a required field, query helpers that always include the tenant predicate, and an
explicit `assert_owned()` on every write path that stores a reference to another
document. MongoDB has no foreign keys, so that last one is an application
guarantee rather than a database one, and the tests are written accordingly. CRUD for cats, feeding schedules and events, cleaning tasks,
vet records and weight logs. The notification engine sends a daily digest at
each account's local time and alerts on anything past its per-task-type overdue
threshold, through the in-app notification centre and Expo push.

**Web** ([details](web/README.md)) — signup/login, a "what's due today" dashboard
with one-tap completion, cat profiles with a weight chart, feeding and cleaning
management, vet records, the notification centre, and settings for the digest
time and every overdue threshold.

**Mobile** ([details](mobile/README.md)) — Expo SDK 57 with expo-router, the
same features as the web app, laid out for phone and tablet (single column
below 768pt, two or three columns above, following rotation live). Tokens are
kept in SecureStore. Push is real: the app registers its Expo token with
`/devices` on every launch and the backend pushes through the Expo service.
That needs a development or EAS build — Expo Go cannot receive push for this
project — so `mobile/README.md` covers `eas init`, FCM V1 and APNs setup.

## Plans and billing

`plan` is on the account (`free` / `pro`, default `free`), but billing is not
live: `backend/app/core/plans.py` gives both plans unlimited everything. Call
sites already ask `within_limit(...)`, so tightening the free tier later is a
one-line change rather than an audit.

## Tests

```bash
docker compose up -d mongo   # the backend suite needs a real MongoDB
cd backend && pytest
cd web && npm run typecheck && npm run lint
cd mobile && npm run typecheck && npm run doctor
```

The backend suite runs entirely against a real MongoDB — no mocks, no skips. It
uses `TEST_MONGODB_DB_NAME` and wipes it between tests, so development data is
never touched, and it fails rather than passing quietly if no server is up.

## Deploying to Railway

Three services against one MongoDB instance (add the MongoDB plugin; it
injects `MONGO_URL`, which the backend picks up automatically):

| Service | Root | Start command |
| --- | --- | --- |
| API | `backend` | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Worker | `backend` | `python -m app.worker` |
| Web | `web` | `npm run start` |

Set `SECRET_KEY`, `ENVIRONMENT=production` and `CORS_ORIGINS` on the API and the
worker; set `NEXT_PUBLIC_API_URL` on the web service. There is no migration
step — Beanie creates collections and indexes on startup.

The mobile app is not deployed to Railway — it ships through EAS Build, with
the API URL baked into each profile in `mobile/eas.json`.
