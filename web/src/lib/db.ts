import "server-only";
import postgres from "postgres";
import { loadEnvConfig } from "@next/env";
import path from "node:path";

const databaseGlobal = globalThis as unknown as {
  poloSql?: ReturnType<typeof postgres>;
  poloSchema?: Promise<void>;
};

export function getDb() {
  if (!databaseGlobal.poloSql) {
    // Next loads web/.env* itself. Also support the workspace root environment.
    if (!process.env.DATABASE_URL) {
      loadEnvConfig(path.resolve(process.cwd(), ".."), process.env.NODE_ENV !== "production", undefined, true);
    }
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_NOT_CONFIGURED");
    databaseGlobal.poloSql = postgres(url, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }
  return databaseGlobal.poloSql;
}

export async function ensureSchema(): Promise<void> {
  if (!databaseGlobal.poloSchema) {
    databaseGlobal.poloSchema = initializeSchema().catch((error: unknown) => {
      databaseGlobal.poloSchema = undefined;
      throw error;
    });
  }
  return databaseGlobal.poloSchema;
}

async function initializeSchema() {
  await getDb().begin(async (sql) => {
    // Serialize initialization across app processes, including the initial seed.
    await sql`SELECT pg_advisory_xact_lock(1886350447)`;
    await sql`
      CREATE TABLE IF NOT EXISTS monitors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        status_code INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        ssl_expiry_days INTEGER NOT NULL DEFAULT 0,
        last_checked TIMESTAMPTZ DEFAULT NOW()
      )`;
    await sql`
      CREATE TABLE IF NOT EXISTS incidents (
        id SERIAL PRIMARY KEY,
        monitor_id TEXT NOT NULL,
        url TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS incidents_created_at_idx ON incidents (created_at DESC, id DESC)`;
    const [count] = await sql`SELECT COUNT(*)::int AS total FROM monitors`;
    if (count.total === 0) {
      await sql`
        INSERT INTO monitors (id, name, url, status, status_code, latency_ms, ssl_expiry_days)
        VALUES
          ('mon-1', 'Google', 'https://www.google.com', 'UP', 200, 95, 62),
          ('mon-2', 'GitHub', 'https://github.com', 'UP', 200, 140, 80),
          ('mon-3', 'Simulated Failing Endpoint', 'https://httpstat.us/500', 'DOWN', 500, 310, 45)`;
    }
  });
}

export function monitorColumns() {
  return getDb()`id, name, url, status, status_code AS "statusCode", latency_ms AS "latencyMs",
    ssl_expiry_days AS "sslExpiryDays", last_checked AS "lastChecked"`;
}
