import { NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db";
import { apiError, httpUrl, integer, readBody, requiredString, RequestError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const id = requiredString(body.monitorId, "Monitor ID", 200);
    const url = httpUrl(body.url);
    const status = body.status;
    if (status !== "UP" && status !== "DOWN" && status !== "PENDING") throw new RequestError("Status must be UP, DOWN, or PENDING.");
    const statusCode = integer(body.statusCode, "Status code", 0, 599);
    const latencyMs = integer(body.latencyMs, "Latency", 0);
    const sslExpiryDays = integer(body.sslExpiryDays, "SSL expiry days", -2147483648);
    const checkedAt = requiredString(body.checkedAt, "Check timestamp", 64);
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(checkedAt) || !Number.isFinite(Date.parse(checkedAt))) {
      throw new RequestError("Check timestamp must be an ISO 8601 date with a timezone.");
    }
    await ensureSchema();
    await getDb().begin(async (sql) => {
      const rows = await sql`
        UPDATE monitors SET url = ${url}, status = ${status}, status_code = ${statusCode},
          latency_ms = ${latencyMs}, ssl_expiry_days = ${sslExpiryDays}, last_checked = ${checkedAt}
        WHERE id = ${id} RETURNING id`;
      if (!rows.length) throw new RequestError("Monitor not found.", 404);
      if (status === "DOWN" || statusCode >= 400) {
        const reason = statusCode >= 400 ? `HTTP ${statusCode} response received` : "Endpoint reported DOWN";
        await sql`INSERT INTO incidents (monitor_id, url, status_code, reason, created_at)
          VALUES (${id}, ${url}, ${statusCode}, ${reason}, ${checkedAt})`;
      }
    });
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}
