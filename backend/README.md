# Cattery Tracker — Backend

FastAPI + MongoDB (Beanie ODM) API for the Cattery Tracker web and mobile
clients. Multi-tenant: every tenant-owned document carries `user_id`, and
requests are scoped to the account in the bearer token.

## Quick start

```bash
# 1. A local MongoDB (either option works)
docker compose up -d              # from the repo root: MongoDB + admin UI on :8082
./scripts/mongo-local.sh          # or: no Docker, no admin rights, no service

# 2. The API
python -m venv .venv && .venv/Scripts/activate    # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env                              # then set SECRET_KEY
uvicorn app.main:app --reload
```

There is no migration step. Beanie creates the collections and their indexes on
startup, so a fresh database is ready the first time the app boots.

Interactive docs at http://localhost:8000/docs (disabled when
`ENVIRONMENT=production`).

Generate a secret key with `python -c "import secrets; print(secrets.token_hex(32))"`.

## Layout

```
app/
  core/       config (env settings), security (argon2 + JWT), plans (entitlements)
  db/         base documents + BSON encoders, Mongo client, tenancy helpers
  models/     Beanie documents — one module per domain area
  schemas/    Pydantic request/response models
  services/   use-cases, including the hand-written cascade deletes
  api/        deps.py (auth dependency) + routes/
scripts/      mongo-local.sh — a MongoDB for development without Docker
tests/        the whole suite, run against a real MongoDB
```

## Endpoints

**Auth & account**

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/auth/signup` | Email + phone + password; returns tokens and seeds notification preferences |
| POST | `/api/v1/auth/login` | Email + password |
| POST | `/api/v1/auth/refresh` | Single-use rotation — the presented token is revoked |
| POST | `/api/v1/auth/logout` | One session, or all when `refresh_token` is omitted |
| POST | `/api/v1/auth/change-password` | Revokes every other session |
| GET | `/api/v1/auth/me` · `/api/v1/users/me` | Current account |
| PATCH | `/api/v1/users/me` | Profile, timezone, digest time, push toggle |
| GET/PATCH | `/api/v1/users/me/notification-preferences` | Per-task-type overdue thresholds |
| DELETE | `/api/v1/users/me` | Deletes the account and cascades the whole tenant |

**Care records** — all list endpoints are `?limit=&offset=` paginated and return
`{items, total, limit, offset}`.

| Method | Path | Notes |
| --- | --- | --- |
| GET/POST | `/api/v1/cats` | `?is_active=&search=` |
| GET/PATCH/DELETE | `/api/v1/cats/{cat_id}` | |
| GET/POST | `/api/v1/feeding-schedules` | `?cat_id=&is_active=` |
| GET/PATCH/DELETE | `/api/v1/feeding-schedules/{id}` | |
| GET/POST | `/api/v1/feeding-events` | `?cat_id=&status=&due_from=&due_to=` |
| GET/PATCH/DELETE | `/api/v1/feeding-events/{id}` | |
| POST | `/api/v1/feeding-events/{id}/complete` · `/skip` | |
| POST | `/api/v1/feeding-events/generate` | Materialise events from schedules; idempotent |
| GET/POST | `/api/v1/cleaning-tasks` | `?zone=&is_active=&due_before=` |
| GET/PATCH/DELETE | `/api/v1/cleaning-tasks/{id}` | |
| POST | `/api/v1/cleaning-tasks/{id}/complete` | Logs history and rolls `next_due_at` forward |
| GET | `/api/v1/cleaning-events` | Cleaning history |
| GET/POST | `/api/v1/vet-records` | `?cat_id=&record_type=&due_from=&due_to=&outstanding=` |
| GET/PATCH/DELETE | `/api/v1/vet-records/{id}` | |
| POST | `/api/v1/vet-records/{id}/complete` | Optionally books the follow-up as a new record |
| GET/POST | `/api/v1/weight-logs` | `?cat_id=&measured_from=&measured_to=` |
| GET/PATCH/DELETE | `/api/v1/weight-logs/{id}` | |
| GET | `/api/v1/cats/{cat_id}/weight-trend` | Aggregates for the weight chart |

**Notifications**

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/notifications` | `?unread_only=&type=&created_since=` |
| GET | `/api/v1/notifications/unread-count` | Badge count |
| POST | `/api/v1/notifications/{id}/read` · `/unread` | |
| POST | `/api/v1/notifications/read-all` | |
| DELETE | `/api/v1/notifications/{id}` | |
| GET | `/api/v1/due-summary` | "What's due today?" — overdue / today / upcoming |
| GET | `/api/v1/due-summary/digest-preview` | Exactly what the digest would say; records nothing |
| POST | `/api/v1/due-summary/send-digest` | Send today's digest now (idempotent per local day) |
| GET/POST | `/api/v1/devices` | Register an Expo push token |
| DELETE | `/api/v1/devices/{device_id}` | Called on sign-out |
| GET | `/health` · `/health/db` | Liveness / readiness |

## Multi-tenant isolation

**Read this before adding a collection.** The Postgres version had three
layers. MongoDB has no foreign keys, so **one of them is gone**: the composite
`(cat_id, user_id) -> cats(id, user_id)` constraint that made a cross-tenant
reference *unrepresentable* has no equivalent. What remains:

1. **Required field** — `user_id` on every tenant document, via
   `TenantDocument`, indexed as the leading key of each collection's compound
   indexes.
2. **Query helpers** — `app/db/tenancy.py`. Route handlers must not call
   `Model.find()` on a tenant collection; `tenant_query()` and
   `get_owned_or_404()` always include the `user_id` predicate, and a document
   owned by someone else returns **404**, never 403.
3. **`assert_owned()`** — the replacement for the composite foreign key. Call it
   for every id that arrives in a request body and gets written into another
   document (`cat_id`, `schedule_id`, …). This is now an *application*
   guarantee: nothing in the database will catch a write path that forgets it.

Because a database-enforced layer became application code, the tests carry more
weight than they used to:

- `tests/test_tenant_isolation.py` — scoping, `assert_owned`, and a case that
  walks **every** endpoint accepting a `cat_id` and asserts each one rejects
  another tenant's cat.
- `tests/test_cascade.py` — the hand-written cascades, including a check that
  every registered tenant collection appears in the cascade list, so a new
  collection cannot be silently orphaned when an account is deleted.
- `tests/test_indexes.py` — that each unique/partial index exists and actually
  rejects the write it is meant to.

### No ON DELETE CASCADE either

`app/services/cascade.py` deletes children before parents, so a partial failure
leaves a retryable state rather than orphans — deleting the parent first would
leave documents that nothing points at and no query would ever surface.

## Auth model

- **Ids** — MongoDB `ObjectId` (`PydanticObjectId`), serialised as the same
  kind of opaque string the clients already handled, so neither the web nor the
  mobile app needed a change.
- **Passwords** — argon2id (`argon2-cffi`). No 72-byte truncation, and stored
  hashes are transparently upgraded on login when parameters change.
- **Access token** — stateless JWT (HS256), 30 min by default, `typ: "access"`
  so a refresh token cannot be replayed against a protected route.
- **Refresh token** — opaque random string, 30 days. Only its SHA-256 digest is
  stored (`refresh_tokens`), so a database dump cannot be replayed, and each
  session can be revoked individually. Refresh is single-use: presenting one
  revokes it and issues a new pair.
- Login returns the same 401 body for an unknown email and a wrong password, so
  the endpoint cannot be used to enumerate accounts.

## Plans

`plan` is on `users` (`free` / `pro`, default `free`). Billing is not live:
`app/core/plans.py` gives **both** plans unlimited everything today. Call sites
should already ask `within_limit(user.plan, "max_cats", count)` so tightening the
free tier later is a one-line change.

## Notification settings

Signup embeds one notification preference per task type in the account
document with the SKILL.md defaults — feeding 120 min, cleaning 360 min, vet 1440 min, vaccination
1440 min, medication 60 min — each user-adjustable, with `in_app_enabled`,
`push_enabled` and `include_in_digest` toggles. Digest time (`08:00` default)
and IANA `timezone` live on `users`.

## Notification engine

Two triggers, exactly as SKILL.md specifies — in-app rows plus native push, no
Telegram or WhatsApp.

**Daily digest.** Once per account per local day, at their `digest_time`.
Summarises today's feedings, cleaning due today, vet/vaccination deadlines for
the coming week, and flags overdue items with how late they are. Deduped by a
`digest:<local-date>` key on a partial unique index, so a double-run or a
restart cannot send it twice.

**Overdue alerts.** The sweep alerts on any item past its per-task-type
threshold. Each item alerts once: `overdue_alerted_at` is latched on the
underlying row, and the notification also carries an
`overdue:<task-type>:<id>` dedupe key. Completing an item clears the latch, so a
re-opened task can alert again. Pending feedings whose local day has ended are
marked `missed` — an event stays actionable all day first.

Both read the same `app/services/due.py` summary that backs
`GET /api/v1/due-summary`, so the digest and the app can never disagree about
what is owed.

**Running it.** `python -m app.worker` (the `worker` process in the Procfile)
sweeps every `OVERDUE_SWEEP_INTERVAL_MINUTES` (default 15). Each account is
processed in its own transaction, so one bad row cannot stall the others. Both
jobs are idempotent, so the worker is safe to restart, run twice, or trigger by
hand while debugging.

**Push.** `app/services/push.py` posts to the Expo push service — the same path
an EAS-built app receives notifications on. Sending needs no Expo credentials,
just the device's `ExponentPushToken[...]`; set `EXPO_ACCESS_TOKEN` only if the
Expo project has enhanced push security enabled. Tokens Expo reports as
`DeviceNotRegistered` are deactivated automatically. Push failures are recorded
on the notification row and never roll back the in-app notification.

## Schema and indexes

There are no migrations. `init_beanie` registers `ALL_DOCUMENT_MODELS` at
startup and creates each collection's indexes, so adding a field is just adding
a field. Two consequences worth knowing:

- **A new document type must be added to `ALL_DOCUMENT_MODELS`** in
  `app/models/__init__.py`, and to `TENANT_DOCUMENT_MODELS` if it carries a
  `user_id`. A test fails if you forget the second one.
- **Changing an existing index's definition does not rebuild it.** MongoDB
  ignores a `createIndex` whose name matches an existing index with different
  options, so drop the old one by hand when you change one.

### BSON type notes

BSON has no `time`, `date` or `Decimal`, so `app/db/base.py` encodes them:
`time`/`date` as ISO strings, `Decimal` as a string for an exact round trip
(Decimal128 cannot be parsed back by Pydantic). The `datetime` identity encoder
in that table is load-bearing — `datetime` subclasses `date`, so without it the
`date` encoder captures every timestamp and stores it as a **string**, silently
turning every `due_at` range query into a string comparison.

BSON datetimes are millisecond precision. Documents truncate to milliseconds on
validation, so what the API returns is exactly what is stored; otherwise a POST
response and the next GET would disagree about the same record.

## Tests

```bash
docker compose up -d mongo   # or ./scripts/mongo-local.sh
pytest
```

(The tests need only the `mongo` service; the admin UI is optional.)

Every test runs against a real MongoDB — no mock, no skip path. The behaviour
that matters most here (unique and partial indexes, upsert deduplication,
`$setOnInsert`, aggregation pipelines) is server behaviour, and a fake would
prove nothing about it. The suite uses `TEST_MONGODB_DB_NAME` and wipes it
between tests, so it never touches development data. If MongoDB is unreachable
the run **fails** rather than quietly passing.

## Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `SECRET_KEY` | yes | — | ≥16 chars; rotating it invalidates every access token |
| `MONGODB_URL` | no | `mongodb://127.0.0.1:27017` | Railway's `MONGO_URL` is used when this is left at the default |
| `MONGODB_DB_NAME` | no | `cattery` | |
| `TEST_MONGODB_DB_NAME` | no | `cattery_test` | Wiped between tests |
| `ENVIRONMENT` | no | `local` | `production` hides `/docs` and `/openapi.json` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | no | `30` | |
| `REFRESH_TOKEN_EXPIRE_DAYS` | no | `30` | |
| `CORS_ORIGINS` | no | localhost:3000, :8081 | JSON array or comma-separated |
| `EXPO_ACCESS_TOKEN` | no | — | Only if the Expo project enforces enhanced push security |
| `OVERDUE_SWEEP_INTERVAL_MINUTES` | no | `15` | Worker sweep cadence |
| `NOTIFICATION_RETENTION_DAYS` | no | `90` | Read notifications older than this are pruned |

## Deploying to Railway

Add the MongoDB plugin; it injects `MONGO_URL`, which the settings pick up
automatically. Set `SECRET_KEY`, `ENVIRONMENT=production` and `CORS_ORIGINS`.
The `Procfile` defines two processes: `web` (uvicorn — no migration step) and
`worker` (the notification sweep). Deploy the worker as a second Railway service
pointed at the same repo and database, with the start command
`python -m app.worker`.

The app needs no multi-document transactions by design, so a standalone server
is enough; it runs unchanged against a replica set or Atlas.

Requires Python 3.12+ and MongoDB 6+ (partial indexes and `$facet` are used).

## Not built yet

The mobile/tablet Expo client. The web app lives in `../web`.
