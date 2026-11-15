# Role & Objective: Autonomous Next.js + Neon PostgreSQL Builder

You are an autonomous Senior Full-Stack TypeScript Engineer. Your sole job in this session is to build, type-check, and verify the complete Next.js frontend and backend API (`./web`) for **Polo | Uptime Monitoring and Incident Alerting Platform**.

Do NOT ask me to write code or explain steps. Build every file inside `./web` automatically, run the terminal build checks yourself, fix any errors, and stop once `./web` compiles cleanly.

---

# Tech Stack & Configuration (`./web`)

1. **Core Stack:**
   - **Next.js** (latest version, App Router)
   - **TypeScript** (latest version, strict mode)
   - **Tailwind CSS** (latest version, clean dark-mode SRE aesthetic)
   - **Database:** **Neon Serverless PostgreSQL** via `DATABASE_URL` environment variable using the lightweight `postgres` (`postgres.js`) npm package (no heavy ORM migration steps required).
2. **Next.js Standalone Config:**
   - Configure `output: 'standalone'` inside `next.config.ts` (or `next.config.mjs`) so the app is ready for multi-stage Dockerization.
3. **Environment Variable Setup:**
   - Read `process.env.DATABASE_URL` in `./web/src/lib/db.ts`.
   - Create a `.env.example` file with `DATABASE_URL="postgresql://user:password@ep-xyz.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"`.
   - If `.env` or `.env.local` already exists in `./web` or the root directory, use its `DATABASE_URL`.

---

# Database Schema & Auto-Initialization (`./web/src/lib/db.ts`)

Write an `ensureSchema()` helper in `./web/src/lib/db.ts` that automatically runs on the first API call (`CREATE TABLE IF NOT EXISTS`) and seeds the 3 default monitors if the `monitors` table is empty:

1. **Table `monitors`:**
   - `id` TEXT PRIMARY KEY
   - `name` TEXT NOT NULL
   - `url` TEXT NOT NULL
   - `status` TEXT NOT NULL DEFAULT `'PENDING'`
   - `status_code` INTEGER NOT NULL DEFAULT `0`
   - `latency_ms` INTEGER NOT NULL DEFAULT `0`
   - `ssl_expiry_days` INTEGER NOT NULL DEFAULT `0`
   - `last_checked` TIMESTAMPTZ DEFAULT NOW()

2. **Table `incidents`:**
   - `id` SERIAL PRIMARY KEY
   - `monitor_id` TEXT NOT NULL
   - `url` TEXT NOT NULL
   - `status_code` INTEGER NOT NULL
   - `reason` TEXT NOT NULL
   - `created_at` TIMESTAMPTZ DEFAULT NOW()

3. **Default Seed Monitors (Insert if `SELECT COUNT(*) FROM monitors` is 0):**
   - `('mon-1', 'Google', 'https://www.google.com', 'UP', 200, 95, 62)`
   - `('mon-2', 'GitHub', 'https://github.com', 'UP', 200, 140, 80)`
   - `('mon-3', 'Simulated Failing Endpoint', 'https://httpstat.us/500', 'DOWN', 500, 310, 45)`

---

# Strict Backend API Contract (Must Match Exactly for Our Go Service)

Mark all API route files with `export const dynamic = 'force-dynamic'` so Next.js never caches stale database reads during `next build`.

1. **`GET /api/monitors`:**
   - Calls `ensureSchema()` and returns HTTP 200 with camelCase JSON array:
     `[{"id": "mon-1", "name": "Google", "url": "https://www.google.com", "status": "UP", "statusCode": 200, "latencyMs": 95, "sslExpiryDays": 62, "lastChecked": "..."}]`
2. **`POST /api/monitors`:**
   - Accepts `{"name": "...", "url": "..."}` and inserts a new row into `monitors`.
3. **`DELETE /api/monitors?id=...`:**
   - Deletes the specified monitor and its incidents from PostgreSQL.
4. **`POST /api/check-result`:**
   - Accepts probe results from our external Go worker with this exact JSON payload:
     `{"monitorId": "mon-1", "url": "https://www.google.com", "status": "UP", "statusCode": 200, "latencyMs": 120, "sslExpiryDays": 65, "checkedAt": "2026-11-15T10:00:00Z"}`
   - Updates the monitor row in `monitors`.
   - If `status === "DOWN"` or `statusCode >= 400`, inserts an incident record into `incidents`.
5. **`GET /api/incidents`:**
   - Returns HTTP 200 with the latest 25 rows from `incidents` ordered by `created_at DESC`.

---

# Polo Frontend UI (`./web/src/app/page.tsx`)

Build a clean, modern dark-mode SRE dashboard titled **Polo | Uptime Monitoring and Incident Alerting Platform**:

- Auto-polls `/api/monitors` and `/api/incidents` every 15 seconds.
- Summary KPI cards: Total Monitors, Operational (`UP`), Down (`DOWN`), and Average Latency (`ms`).
- Add Monitor form (`name` and `url` inputs) + Delete button on each monitor row.
- Monitor table displaying: UP/DOWN status badge, Name, URL, HTTP Status Code, Latency (`ms`), SSL Certificate Expiry (`days`), and Last Checked time.
- Incident History table at the bottom showing recent downtime events.

---

# Autonomous Verification Checklist

Before finishing, run these commands in the terminal and fix any issues:

1. Install dependencies (`bun install` inside `./web`).
2. Run TypeScript check (`npx tsc --noEmit`) and ensure 0 errors.
3. Run production build (`bun run build`) and verify `.next/standalone` is created cleanly even if `DATABASE_URL` is not yet connected during build time.

Start immediately without asking for confirmation. When all checks pass, print "PHASE 1 COMPLETE - READY FOR GO & DEVOPS MENTOR" and stop.
