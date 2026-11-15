import { NextResponse } from "next/server";
import { ensureSchema, getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import type { Incident } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSchema();
    const incidents = await getDb()<Incident[]>`SELECT id, monitor_id, url, status_code, reason, created_at
      FROM incidents ORDER BY created_at DESC, id DESC LIMIT 25`;
    return NextResponse.json(incidents);
  } catch (error) { return apiError(error); }
}
