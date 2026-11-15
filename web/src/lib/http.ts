import { NextResponse } from "next/server";

export class RequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await request.json(); } catch { throw new RequestError("Provide a valid JSON body."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError("Provide a JSON object.");
  }
  return body as Record<string, unknown>;
}

export function requiredString(value: unknown, label: string, max = 2048): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new RequestError(`${label} is required and must be at most ${max} characters.`);
  }
  return value.trim();
}

export function httpUrl(value: unknown): string {
  const text = requiredString(value, "URL");
  let url: URL;
  try { url = new URL(text); } catch { throw new RequestError("Enter a valid HTTP or HTTPS URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new RequestError("Use an HTTP or HTTPS URL without embedded credentials.");
  }
  return text;
}

export function integer(value: unknown, label: string, min: number, max = 2147483647): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new RequestError(`${label} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export function apiError(error: unknown) {
  if (error instanceof RequestError) return NextResponse.json({ error: error.message }, { status: error.status });
  // Never return database errors: they can include credentials or query details.
  return NextResponse.json({ error: "Database unavailable. Check DATABASE_URL and your database connection, then retry." }, { status: 503 });
}
