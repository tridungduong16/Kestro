<p align="center">
  <img src="./apps/web/public/logo.png" alt="Kestro Logo" width="160" />
</p>

# Kestro

Kestro is a lightweight, self-hostable HTTP scheduler inspired by Google Cloud Scheduler. It combines a Next.js dashboard with a Rust API and background worker so teams can create recurring HTTP jobs, run them manually, inspect execution history, and import Bruno request files as schedule drafts.

## What It Does

- Creates, edits, pauses, resumes, deletes, and manually runs HTTP schedules.
- Supports `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS` requests.
- Stores target URL, method, headers, payload, cron expression, timeout, retry count, and next run time.
- Executes active schedules from a Rust background worker on a configurable tick interval.
- Records execution status, HTTP status code, duration, error details, and truncated response body.
- Imports Bruno `.bru` request files into paused schedule drafts before saving.
- Provides a dashboard for schedule management, run history, worker status, and API reference.
- Persists schedules and execution history in MySQL.

## Tech Stack

- **Frontend:** Next.js 15, React 19, TypeScript, Tailwind CSS, Radix UI, TanStack Query, React Hook Form, Zod, Lucide icons.
- **Backend:** Rust, Axum, Tokio, SQLx, MySQL, Reqwest, `cron`, `dotenvy`, Tracing.
- **Infrastructure:** Docker Compose for local MySQL.

## Project Structure

```text
.
├── apps
│   ├── api
│   │   ├── migrations       # SQLx MySQL migrations
│   │   └── src/main.rs      # Axum API, scheduler worker, Bruno import parser
│   └── web
│       ├── app              # Next.js app router entry
│       ├── components       # Dashboard and UI primitives
│       ├── lib              # Shared frontend types/utilities
│       └── public/logo.png
├── docker-compose.yml       # Local MySQL service
├── package.json             # Root npm workspace scripts
├── Cargo.toml               # Rust workspace
└── README.md
```

## Prerequisites

- Node.js and npm
- Rust toolchain with Cargo
- Docker and Docker Compose

## Quick Start

Install dependencies:

```bash
npm install
```

Start MySQL:

```bash
docker compose up -d mysql
```

Create the API environment file:

```bash
cp apps/api/.env.example apps/api/.env
```

Run the API:

```bash
npm run dev:api
```

Run the web app in another terminal:

```bash
npm run dev:web
```

Open the default local URLs:

- Web: `http://localhost:3000`
- API: `http://127.0.0.1:8080`
- Health check: `http://127.0.0.1:8080/health`

The root `npm run start` and `npm run start:server` commands start the web app on the first free port from `3000` to `3010`.

## Environment Variables

The API loads environment variables from the first readable file in this order:

1. `apps/api/.env`
2. `.env`

Those files are not merged. If both exist, `apps/api/.env` wins. The root `.env` in local development may use `DB_PASS`; `apps/api/.env.example` uses `DB_PASSWORD`. The backend accepts either name.

### API Environment

| Variable | Default | Description |
| --- | --- | --- |
| `DB_HOST` | `localhost` | MySQL host. |
| `DB_PORT` | `3306` | MySQL port. Must be a valid TCP port. |
| `DB_USER` | `kestro` | MySQL user. |
| `DB_PASSWORD` | `kestro` | MySQL password. |
| `DB_PASS` | unset | Optional fallback if `DB_PASSWORD` is not set. |
| `DB_NAME` | `kestro` | MySQL database name. |
| `DATABASE_URL` | unset | Optional full MySQL connection string. When set, it overrides the `DB_*` values. |
| `BIND_ADDR` | `127.0.0.1:8080` | API host and port. |
| `SCHEDULER_TICK_SECONDS` | `30` | How often the worker checks for due schedules. Invalid values fall back to `30`. |

Example API environment:

```dotenv
DB_HOST=localhost
DB_PORT=3306
DB_USER=kestro
DB_PASSWORD=kestro
DB_NAME=kestro
BIND_ADDR=127.0.0.1:8080
SCHEDULER_TICK_SECONDS=30
```

### Web Environment

The dashboard calls the API from:

```dotenv
NEXT_PUBLIC_API_URL=http://127.0.0.1:8080
```

This value is optional. If it is not set, the frontend defaults to `http://127.0.0.1:8080`. For local overrides, create `apps/web/.env.local` because the web server runs from `apps/web`.

## Scripts

| Command | Description |
| --- | --- |
| `npm run start` | Alias for `npm run start:server`. |
| `npm run start:server` | Start the web dev server on the first free port from `3000`. Honors `HOST`, `PORT`, and `MAX_PORT`. |
| `npm run dev:web` | Start the Next.js development server. |
| `npm run build:web` | Build the web app. |
| `npm run lint:web` | Run ESLint for the web app. |
| `npm run dev:api` | Run the Rust API and scheduler worker. |
| `npm run check:api` | Run `cargo check` for the API crate. |

## Frontend

The dashboard lives in `apps/web/components/scheduler-dashboard.tsx` and is backed by the local API through TanStack Query. The main views are:

- **Schedules:** create/edit jobs, search schedules, toggle active/paused status, delete jobs, and run a schedule immediately.
- **History:** view recent executions across schedules, including status, duration, HTTP code, and errors.
- **Workers:** inspect local scheduler status cards derived from schedule and execution data.
- **API:** view the local API base URL, endpoint list, and Bruno import example.

Schedule forms are validated in the browser with Zod before being sent to the API:

- `name` must be at least 3 characters.
- `targetUrl` must be a valid URL.
- `headers` must be an empty value or a JSON object.
- `timeoutSeconds` must be between `1` and `120`.
- `retryCount` must be between `0` and `5`.

## Backend

The API and worker live in `apps/api/src/main.rs`.

- The API starts an Axum server at `BIND_ADDR`.
- SQLx migrations run automatically on API startup.
- MySQL sessions are set to UTC with `SET time_zone = '+00:00'`.
- CORS is open for local dashboard access.
- The scheduler checks due jobs every `SCHEDULER_TICK_SECONDS`.
- Each tick loads up to 25 active schedules whose `next_run_at` is due.
- A due schedule is advanced to its next run before execution is spawned.
- HTTP executions use the stored timeout and retry count.
- A run is marked `success` only for HTTP `2xx` responses.
- Failed runs retry with short incremental delays.
- Execution response bodies are truncated to 2,000 characters before storage.

Schedule validation on the backend enforces:

- Target URLs must use `http` or `https`.
- Headers must be a JSON object.
- Status must be `active` or `paused`.
- Timeout must be between `1` and `120` seconds.
- Retry count must be between `0` and `5`.
- Five-field cron expressions are accepted and normalized by adding seconds as `0`.

## API Reference

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Check API and database connectivity. |
| `POST` | `/api/imports/bruno/request` | Preview one Bruno `.bru` request as a schedule draft. |
| `GET` | `/api/schedules` | List schedules, newest first. |
| `POST` | `/api/schedules` | Create a schedule. |
| `GET` | `/api/schedules/{id}` | Get one schedule by UUID. |
| `PATCH` | `/api/schedules/{id}` | Update one schedule. |
| `DELETE` | `/api/schedules/{id}` | Delete one schedule. |
| `POST` | `/api/schedules/{id}/run` | Run a schedule immediately. |
| `GET` | `/api/schedules/{id}/executions` | List the latest 100 executions for a schedule. |

Create a schedule:

```bash
curl -X POST http://127.0.0.1:8080/api/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Billing reconciliation",
    "targetUrl": "https://api.example.com/jobs/reconcile",
    "method": "POST",
    "cronExpression": "*/15 * * * *",
    "headers": {
      "Content-Type": "application/json"
    },
    "payload": "{\"mode\":\"incremental\"}",
    "status": "active",
    "timeoutSeconds": 30,
    "retryCount": 2
  }'
```

Run a schedule immediately:

```bash
curl -X POST http://127.0.0.1:8080/api/schedules/{id}/run
```

Import a Bruno request preview:

```bash
curl -X POST http://127.0.0.1:8080/api/imports/bruno/request \
  -F "file=@./requests/billing.bru"
```

The Bruno import endpoint does not create a schedule. It returns a paused draft with a default hourly cron expression, copied headers, copied body, appended query params, and warnings for unresolved Bruno variables or unsupported blocks such as scripts, tests, auth, cookies, docs, and collection variables.

## Database

Local MySQL is defined in `docker-compose.yml`:

- Service: `mysql`
- Image: `mysql:8.4`
- Container: `kestro-mysql`
- Port: `3306`
- Volume: `kestro-mysql`
- Default database/user/password match `apps/api/.env.example`

The initial migration creates:

- `schedules`
- `executions`
- indexes for due schedules and execution history

Stop local MySQL:

```bash
docker compose down
```

Stop local MySQL and remove its persisted data:

```bash
docker compose down -v
```

## Verification

Run these checks before shipping changes:

```bash
npm run lint:web
npm run build:web
npm run check:api
```
