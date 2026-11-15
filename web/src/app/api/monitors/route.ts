import { NextResponse } from "next/server";
import { ensureSchema, getDb, monitorColumns } from "@/lib/db";
import { apiError, httpUrl, readBody, requiredString, RequestError } from "@/lib/http";
import type { Monitor } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSchema();
    const monitors = await getDb()<Monitor[]>`SELECT ${monitorColumns()} FROM monitors ORDER BY id`;
    return NextResponse.json(monitors);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const name = requiredString(body.name, "Name", 120);
    const url = httpUrl(body.url);
    await ensureSchema();
    const [monitor] = await getDb()<Monitor[]>`
      INSERT INTO monitors (id, name, url, last_checked)
      VALUES (${crypto.randomUUID()}, ${name}, ${url}, NULL)
      RETURNING ${monitorColumns()}`;
    return NextResponse.json(monitor, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  try {
    const id = requiredString(new URL(request.url).searchParams.get("id"), "Monitor ID", 200);
    await ensureSchema();
    await getDb().begin(async (sql) => {
      const monitors = await sql`SELECT id FROM monitors WHERE id = ${id} FOR UPDATE`;
      if (!monitors.length) throw new RequestError("Monitor not found.", 404);
      await sql`DELETE FROM incidents WHERE monitor_id = ${id}`;
      await sql`DELETE FROM monitors WHERE id = ${id}`;
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}
