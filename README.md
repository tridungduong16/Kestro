<p align="center">
  <img src="./apps/web/public/logo.png" alt="Kestro Logo" width="160" />
</p>

# Kestro

Kestro is a lightweight, self-hostable HTTP scheduler inspired by Google Cloud Scheduler. It provides a Next.js dashboard and a Rust API for creating recurring jobs that call HTTP endpoints, track execution history, and support manual runs.

## Features

- Create, edit, pause, resume, delete, and manually run HTTP schedules.
- Configure HTTP method, target URL, headers, payload, timeout, retries, and cron expression.
- Background worker finds due schedules and executes them automatically.
- Persist schedules and execution history in PostgreSQL.
- Health endpoint for service checks.
- Dashboard UI with mock data for local product exploration.

## Tech Stack

- Web: Next.js 15, React 19, TypeScript, Tailwind CSS, Radix UI, TanStack Query, React Hook Form, Zod.
- API: Rust, Axum, Tokio, SQLx, PostgreSQL, Reqwest, cron, Tracing.
- Infrastructure: Docker Compose for local PostgreSQL.

## Project Structure

```text
.
├── apps
│   ├── api          # Rust Axum API and scheduler worker
│   └── web          # Next.js dashboard
├── docker-compose.yml
├── package.json     # root npm workspace scripts
├── Cargo.toml       # Rust workspace
└── README.md
```

## Prerequisites

- Node.js and npm
- Rust toolchain
- Docker and Docker Compose

## Local Development

Install dependencies:

```bash
npm install
```

Start PostgreSQL:

```bash
docker compose up -d postgres
```

Configure the API environment:

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

Or start it with automatic port selection:

```bash
npm run start:server
```

Default local URLs:

- Web: `http://localhost:3000`
- API: `http://127.0.0.1:8080`
- Health: `http://127.0.0.1:8080/health`

The dashboard currently reads from `apps/web/lib/mock-data.ts`. Replace the TanStack Query functions in `apps/web/components/scheduler-dashboard.tsx` when wiring the UI to the API.

## Environment Variables

The API reads these values from the environment:

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://kestro:kestro@localhost:5432/kestro` | PostgreSQL connection string. |
| `BIND_ADDR` | `127.0.0.1:8080` | API host and port. |
| `SCHEDULER_TICK_SECONDS` | `30` | How often the worker checks for due schedules. |

## Scripts

| Command | Description |
| --- | --- |
| `npm run start:server` | Start the web server on the first free port from `3000`. |
| `npm run dev:web` | Start the Next.js development server. |
| `npm run build:web` | Build the web app. |
| `npm run lint:web` | Run ESLint for the web app. |
| `npm run dev:api` | Run the Rust API. |
| `npm run check:api` | Run `cargo check` for the API. |

## API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Check API and database connectivity. |
| `GET` | `/api/schedules` | List schedules. |
| `POST` | `/api/schedules` | Create a schedule. |
| `GET` | `/api/schedules/{id}` | Get one schedule. |
| `PATCH` | `/api/schedules/{id}` | Update one schedule. |
| `DELETE` | `/api/schedules/{id}` | Delete one schedule. |
| `POST` | `/api/schedules/{id}/run` | Run a schedule immediately. |
| `GET` | `/api/schedules/{id}/executions` | List recent executions for a schedule. |

Example schedule creation:

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

Five-field cron expressions are accepted and normalized with seconds set to `0`.

## Database

The API runs SQLx migrations on startup. The initial migration creates:

- `schedules`
- `executions`
- indexes for due schedules and execution history

Local database credentials are defined in `docker-compose.yml`.

## Verification

Run these checks before shipping changes:

```bash
npm run lint:web
npm run build:web
npm run check:api
```
