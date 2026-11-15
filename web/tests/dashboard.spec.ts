import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Incident, Monitor } from "../src/lib/types";

const monitors: Monitor[] = [
  { id: "mon-1", name: "Google", url: "https://www.google.com", status: "UP", statusCode: 200, latencyMs: 95, sslExpiryDays: 62, lastChecked: "2026-11-15T10:00:00Z" },
  { id: "mon-2", name: "GitHub", url: "https://github.com", status: "UP", statusCode: 200, latencyMs: 140, sslExpiryDays: 80, lastChecked: "2026-11-15T10:00:00Z" },
  { id: "mon-3", name: "Simulated Failing Endpoint", url: "https://httpstat.us/500", status: "DOWN", statusCode: 500, latencyMs: 310, sslExpiryDays: 45, lastChecked: "2026-11-15T10:00:00Z" },
];
const incidents: Incident[] = [{ id: 1, monitor_id: "mon-3", url: "https://httpstat.us/500", status_code: 500, reason: "HTTP 500 response received", created_at: "2026-11-15T10:00:00Z" }];

async function mockApi(page: Page, initial = monitors) {
  let rows = structuredClone(initial);
  let reads = 0;
  await page.route("**/api/monitors**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON() as { name: string; url: string };
      const row: Monitor = { ...body, id: "new-monitor", status: "PENDING", statusCode: 0, latencyMs: 0, sslExpiryDays: 0, lastChecked: null };
      rows.push(row);
      return route.fulfill({ status: 201, json: row });
    }
    if (request.method() === "DELETE") {
      rows = rows.filter((monitor) => monitor.id !== new URL(request.url()).searchParams.get("id"));
      return route.fulfill({ status: 204 });
    }
    reads++;
    return route.fulfill({ json: rows });
  });
  await page.route("**/api/incidents", (route) => route.fulfill({ json: initial.length ? incidents : [] }));
  return () => reads;
}

test("dashboard shows metrics, filters, polling, and accessible service data", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  const reads = await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto("/");
  await expect(page.getByText("1 monitor needs your attention")).toBeVisible();
  await expect(page.getByRole("region", { name: "Average latency" })).toContainText("182");
  await expect(page.getByRole("cell", { name: "HTTP 500 response received" })).toBeVisible();
  await expect(page.locator(".monitor-table tbody tr")).toHaveCount(3);
  const before = reads();
  await page.clock.runFor(15_100);
  await expect.poll(reads).toBeGreaterThan(before);
  await page.screenshot({ path: "test-results/polo-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Down", exact: true }).click();
  await expect(page.locator(".monitor-table tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "All monitors" }).click();
  await page.getByRole("searchbox", { name: "Search monitors" }).fill("github");
  await expect(page.locator(".monitor-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".monitor-table")).toContainText("GitHub");
  await page.getByRole("searchbox").fill("not-a-monitor");
  await expect(page.getByText("No matching monitors")).toBeVisible();
  await page.getByRole("searchbox").clear();
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("add and delete monitor, dialog keyboard flow, and mobile layout", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Add monitor", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Monitor name", { exact: true }).fill("Production API");
  await page.getByLabel("Endpoint URL", { exact: true }).fill("https://api.example.com/health");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Create monitor" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".monitor-table")).toContainText("Production API");
  await expect(page.locator(".monitor-table")).toContainText("Awaiting first check");
  await page.getByRole("button", { name: "Delete Production API", exact: true }).click();
  await expect(page.locator(".monitor-table")).not.toContainText("Production API");
  await page.getByRole("button", { name: "Add monitor", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Add monitor", exact: true })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Overview." })).toBeVisible();
  await page.screenshot({ path: "test-results/polo-mobile.png", fullPage: true });
  const overflowing = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1).map((element) => `${element.tagName}.${element.className}`).slice(0, 12));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), overflowing.join(", ")).toBeTruthy();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
});

test("empty and unavailable states are honest and recoverable", async ({ page }) => {
  await mockApi(page, []);
  await page.goto("/");
  await expect(page.getByText("Your services, all in one place.")).toBeVisible();
  await expect(page.getByText("No incidents recorded")).toBeVisible();
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, json: { error: "Database unavailable. Check DATABASE_URL and your database connection, then retry." } }));
  await page.reload();
  await expect(page.locator(".connection-banner")).toContainText("Waiting for a database connection");
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Total monitors" })).toContainText("—");
});
