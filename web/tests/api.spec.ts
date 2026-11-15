import { expect, test } from "@playwright/test";
import type { Incident, Monitor } from "../src/lib/types";

test("PostgreSQL API contract: seed, CRUD, checks, incident ordering, and validation", async ({ request }) => {
  test.skip(!process.env.POLO_TEST_DATABASE_URL, "Set POLO_TEST_DATABASE_URL to an isolated local PostgreSQL database.");
  const database = new URL(process.env.POLO_TEST_DATABASE_URL!);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(database.hostname);
  const initial = await request.get("/api/monitors");
  expect(initial.status()).toBe(200);
  const seeds = await initial.json() as Monitor[];
  expect(seeds).toHaveLength(3);
  expect(seeds.find((monitor) => monitor.id === "mon-1")).toMatchObject({ name: "Google", statusCode: 200, latencyMs: 95, sslExpiryDays: 62 });
  const created = await request.post("/api/monitors", { data: { name: "Contract test", url: "https://example.com/health" } });
  expect(created.status()).toBe(201);
  const monitor = await created.json() as Monitor;
  expect(monitor).toMatchObject({ status: "PENDING", statusCode: 0, lastChecked: null });
  const check = { monitorId: monitor.id, url: monitor.url, status: "UP", statusCode: 200, latencyMs: 120, sslExpiryDays: 65, checkedAt: "2026-11-15T10:00:00Z" };
  expect((await request.post("/api/check-result", { data: check })).status()).toBe(200);
  expect(await (await request.get("/api/incidents")).json()).toHaveLength(0);
  const updated = await (await request.get("/api/monitors")).json() as Monitor[];
  expect(updated.find((row) => row.id === monitor.id)).toMatchObject({ latencyMs: 120, sslExpiryDays: 65, lastChecked: "2026-11-15T10:00:00.000Z" });
  for (let index = 0; index < 27; index++) {
    const result = await request.post("/api/check-result", { data: { ...check, status: index === 0 ? "UP" : "DOWN", statusCode: 500, checkedAt: `2026-11-15T10:00:${String(index).padStart(2, "0")}Z` } });
    expect(result.status()).toBe(200);
  }
  const incidents = await (await request.get("/api/incidents")).json() as Incident[];
  expect(incidents).toHaveLength(25);
  expect(incidents[0]).toMatchObject({ monitor_id: monitor.id, status_code: 500, reason: "HTTP 500 response received", created_at: "2026-11-15T10:00:26.000Z" });
  expect((await request.post("/api/check-result", { data: { ...check, monitorId: "missing-monitor" } })).status()).toBe(404);
  expect((await request.post("/api/check-result", { data: { ...check, checkedAt: "invalid-date" } })).status()).toBe(400);
  expect((await request.post("/api/check-result", { data: { ...check, latencyMs: -1 } })).status()).toBe(400);
  expect((await request.post("/api/monitors", { data: { name: "", url: "https://example.com" } })).status()).toBe(400);
  expect((await request.post("/api/monitors", { data: { name: "Invalid", url: "javascript:alert(1)" } })).status()).toBe(400);
  expect((await request.post("/api/monitors", { data: "{broken", headers: { "Content-Type": "application/json" } })).status()).toBe(400);
  expect((await request.delete("/api/monitors")).status()).toBe(400);
  expect((await request.delete(`/api/monitors?id=${monitor.id}`)).status()).toBe(204);
  expect(await (await request.get("/api/incidents")).json()).toHaveLength(0);
  expect((await request.delete(`/api/monitors?id=${monitor.id}`)).status()).toBe(404);
  expect(await (await request.get("/api/monitors")).json()).toHaveLength(3);
});
