# Polo web

Minimal uptime dashboard and PostgreSQL API, built with Next.js App Router, TypeScript, Tailwind CSS, and postgres.js.

```powershell
bun install
Copy-Item .env.example .env.local
# Set DATABASE_URL in .env.local to your Neon PostgreSQL connection string.
bun run dev
```

Open http://localhost:3000. Existing `web/.env`, `web/.env.local`, and workspace root environment files are supported. Tables and three example monitors initialize on the first API call. The seeded statuses are initial example values; the external Go worker supplies subsequent checks.

The dashboard polls every 15 seconds and supports adding, searching, filtering, and deleting monitors. Incidents are recorded for each failed check, including HTTP responses of 400 or greater. Deleting a monitor also removes its incident history. This phase receives worker results; it does not run probes or deliver external notifications.

## Checks

```powershell
npx tsc --noEmit
bun run build
bunx playwright install chromium
bun run test
```

Browser tests use mocked API data. To also run the database contract test, set `POLO_TEST_DATABASE_URL` to an **isolated local PostgreSQL database** before running tests. The API test adds and removes its own monitor and incidents and expects a fresh seeded database. It refuses remote database hosts.

The build succeeds without a database connection. Production output is in `.next/standalone`. Run `bun run start:standalone` to copy static assets and start that server locally. For a standalone deployment, copy `public` (if present) and `.next/static` beside the generated server into `public` and `.next/static`, then run `node server.js` with `DATABASE_URL` set.

## API

| Endpoint | Behavior |
| --- | --- |
| `GET /api/monitors` | Latest monitor data with camelCase fields |
| `POST /api/monitors` | Create using `{ "name": "API", "url": "https://example.com/health" }` |
| `DELETE /api/monitors?id=…` | Remove monitor and its incidents |
| `POST /api/check-result` | Receive `monitorId`, `url`, `status`, `statusCode`, `latencyMs`, `sslExpiryDays`, and ISO `checkedAt` |
| `GET /api/incidents` | Latest 25 incident rows, newest first; database field names |

Routes are dynamic. Invalid requests return 400; unknown monitors return 404; an unavailable database returns 503 without connection details. This phase follows the worker contract without authentication; use a trusted network or add access control before exposing write endpoints publicly.
