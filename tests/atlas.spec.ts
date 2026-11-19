import { expect, test, type Page } from "@playwright/test";
import type { IntelEvent, Scope } from "../src/types";

// These tests drive the built site on both the desktop and phone projects.
// Intercept only application APIs; the browser loads the bundled atlas normally.
test.use({ serviceWorkers: "block" });

type Area = Exclude<Scope, "all">;
const areaNames: Area[] = ["local", "us", "global"];

function report(id: string, title: string, scope: Area, location: string, category: string, point: [number, number] | null): IntelEvent {
  const url = "https://example.org/atlas/" + id;
  return {
    id, title, scope, location, category, url, source: "Atlas fixture desk",
    lat: point?.[1] ?? null, lon: point?.[0] ?? null,
    summary: "Controlled fixture for map navigation and source attribution.",
    publishedAt: "2026-01-10T12:00:00Z", updatedAt: "2026-01-10T12:01:00Z",
    status: "confirmed", severity: "moderate", rank: 5, rankReasons: [],
    sources: [{ name: "Atlas fixture desk", url }], timeline: [],
    intelligence: {
      level: "elevated", category, score: 72,
      why: title, monitor: "Watch for a published update.",
      reasons: ["Agency update"], changeKey: id,
    },
  };
}
const weather: IntelEvent = {
  ...report("atlas-maui-weather", "Maui weather bulletin", "local", "Maui", "Weather", [-156.33, 20.8]),
  source: "National Weather Service",
  alertArea: {
    type: "MultiPolygon",
    coordinates: [[[[-156.48, 20.69], [-156.16, 20.69], [-156.16, 20.91], [-156.48, 20.91], [-156.48, 20.69]]]],
  },
};
const seismic = report("atlas-maui-quake", "Maui earthquake bulletin", "local", "Maui", "Earthquake", [-156.33, 20.8]);
const domestic = report("atlas-oregon", "Oregon public advisory", "us", "Oregon", "Reported incident", [-120.6, 44.1]);
const international = report("atlas-japan", "Japan public advisory", "global", "Japan", "Reported incident", [138.2, 36.2]);

async function interceptAtlas(page: Page, initial: IntelEvent[]) {
  const feed = { reports: initial, scan: new Date(Date.now() - 180_000).toISOString() };
  await page.route("**/api/preferences", r => r.fulfill({ json: {
    location: "Maui", saved: [], topics: [], history: [], notifications: false,
    account: { enabled: false, signedIn: false },
  } }));
  await page.route("**/api/situation?**", r => r.fulfill({ json: {
    location: "Maui", mode: "sources", updatedAt: feed.scan, generatedAt: feed.scan,
    stale: false, notice: "", citations: [],
    sections: { whatHappened: [], whyItMatters: [], whatToMonitor: [] },
  } }));
  await page.route("**/api/feed?**", r => {
    const p = new URL(r.request().url()).searchParams;
    const view = p.get("view");
    const scope = p.get("scope") || "all";
    const visible = feed.reports.filter(e => (scope === "all" || e.scope === scope) && (!p.get("id") || p.get("id") === e.id));
    // Simulate a busy front page. The Oregon report can only enter the map
    // through the home region selector's separately scoped request.
    const overview = view === "signals" && scope === "all";
    const more = overview && !p.has("cursor") && visible.some(e => e.id === domestic.id);
    const events = overview ? visible.filter(e => p.has("cursor") ? e.id === domestic.id : e.id !== domestic.id)
      : view === "trending" || view === "rabbit" ? [] : visible;
    return r.fulfill({ json: {
      events, nextCursor: more ? "atlas-more" : null, updatedAt: feed.scan,
      health: [{ id: "atlas", name: "Atlas fixture desk", status: "ok", lastSuccess: feed.scan }],
      ...(view === "signals" ? { intelligence: {
        scanned: feed.reports.length, alerts: feed.reports.length, activeWarnings: 0, lastScan: feed.scan,
        regions: areaNames.map(area => {
          const members = feed.reports.filter(e => e.scope === area);
          return { scope: area, level: members.length ? "elevated" : "quiet", count: members.length,
            reason: members.length ? "Published agency report" : "No qualifying reports", eventIds: members.map(e => e.id) };
        }),
        escalations: [], anomalies: [], related: [], hotIds: [], baselineNote: "Insufficient complete days.",
      } } : {}),
    } });
  });
  return feed;
}

test("briefing regions load their own mapped reports and restore the world extent", async ({ page }) => {
  await interceptAtlas(page, [weather, seismic, domestic, international]);
  await page.goto("/");
  const focus = page.getByRole("group", { name: "Situation overview focus" });
  const atlas = page.getByRole("region", { name: "Report atlas" });
  const marker = (name: RegExp) => atlas.getByRole("button", { name });
  await expect(focus.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-pressed", "true");
  await expect(marker(/Japan public advisory/)).toBeVisible();
  await expect(marker(/Oregon public advisory/)).toHaveCount(0);

  await focus.getByRole("button", { name: "Local", exact: true }).click();
  await expect(page.getByRole("article", { name: "Maui assessment" })).toBeVisible();
  await expect(marker(/2 reports near Maui/)).toBeVisible();
  await expect(marker(/Japan public advisory/)).toHaveCount(0);
  await expect(atlas.getByRole("button", { name: "Reset world view" })).toBeEnabled();

  const usRequest = page.waitForResponse(response => {
    const u = new URL(response.url());
    return u.pathname === "/api/feed" && u.searchParams.get("view") === "signals" && u.searchParams.get("scope") === "us";
  });
  await focus.getByRole("button", { name: "U.S.", exact: true }).click();
  expect((await usRequest).ok()).toBe(true);
  await expect(page.getByRole("article", { name: "United States assessment" })).toBeVisible();
  await expect(marker(/Oregon public advisory/)).toBeVisible();
  await expect(marker(/reports near Maui/)).toHaveCount(0);

  await focus.getByRole("button", { name: "Global", exact: true }).click();
  await expect(page.getByRole("article", { name: "Global assessment" })).toBeVisible();
  await expect(marker(/Japan public advisory/)).toBeVisible();
  await expect(marker(/reports near Maui/)).toHaveCount(0);
  await expect(marker(/Oregon public advisory/)).toHaveCount(0);
  await expect(atlas.getByRole("button", { name: "Reset world view" })).toBeDisabled();
});

test("map layers and keyboard selection expose the source reports in an overlapping cluster", async ({ page }) => {
  await interceptAtlas(page, [weather, seismic]);
  await page.goto("/map");
  const atlas = page.getByRole("region", { name: "Report atlas" });
  const warning = atlas.getByRole("button", { name: "Show official warning areas" });
  await expect(atlas.locator("path.eotw-alert-area")).toHaveCount(1);
  await warning.click();
  await expect(warning).toHaveAttribute("aria-pressed", "false");
  await expect(atlas.locator("path.eotw-alert-area")).toHaveCount(0);
  await warning.click();
  await expect(atlas.locator("path.eotw-alert-area")).toHaveCount(1);

  const cluster = atlas.getByRole("button", { name: /2 reports near Maui/ });
  await cluster.focus();
  await cluster.press("Enter");
  const panel = atlas.getByRole("region", { name: "Selected map reports" });
  const close = panel.getByRole("button", { name: "Close map reports" });
  await expect(close).toBeFocused();
  await expect(panel.getByRole("button", { name: /Maui weather bulletin/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: /Maui earthquake bulletin/ })).toBeVisible();
  await close.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(cluster).toBeFocused();

  const weatherLayer = atlas.getByRole("button", { name: "Show weather", exact: true });
  await weatherLayer.click();
  await expect(weatherLayer).toHaveAttribute("aria-pressed", "false");
  await expect(cluster).toHaveCount(0);
  await expect(atlas.locator("path.eotw-alert-area")).toHaveCount(0);
  await atlas.getByRole("button", { name: /Maui earthquake bulletin/ }).click();
  await panel.getByRole("button", { name: /Maui earthquake bulletin/ }).click();
  await expect(page).toHaveURL(/\/story\/atlas-maui-quake$/);
  await expect(page.getByRole("heading", { name: seismic.title, exact: true, level: 1 })).toBeVisible();
});

test("an unmapped local report stays unplotted, and reduced motion suppresses a fresh scan sweep", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const noPoint = report("atlas-no-point", "Maui notice without a mapped location", "local", "Maui", "Reported incident", null);
  const feed = await interceptAtlas(page, [noPoint]);
  await page.goto("/");
  const atlas = page.getByRole("region", { name: "Report atlas" });
  await expect(page.getByRole("article", { name: "Maui assessment" }).getByText(noPoint.title, { exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Situation overview focus" }).getByRole("button", { name: "Local", exact: true }).click();
  await expect(atlas.getByRole("status")).toHaveText("No mapped reports in the local area");
  await expect(atlas.getByRole("button", { name: /Maui notice/ })).toHaveCount(0);
  await expect(atlas.locator(".eotw-scan-sweep")).toHaveCount(0);

  feed.reports = [noPoint, weather];
  feed.scan = new Date().toISOString();
  // Reconnecting runs the same refresh path as the 45-second polling interval.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(atlas.getByRole("button", { name: /Maui weather bulletin/ })).toBeVisible();
  await expect(atlas.getByRole("status")).toHaveCount(0);
  const sweep = atlas.locator(".eotw-scan-sweep");
  await expect(sweep).toHaveCount(1);
  await expect(sweep).toBeHidden();
});

test("a quiet local assessment leads to the local archive and keeps wider warning details readable", async ({ page }) => {
  const warning = {
    ...domestic, id: "atlas-weather-notice", source: "National Weather Service",
    title: "Flood Warning issued January 10 at 8:00AM PST until January 10 at 3:00PM PST by NWS Portland OR",
  };
  await interceptAtlas(page, [warning]);
  await page.goto("/");
  const assessment = page.getByRole("article", { name: "Maui assessment" });
  await expect(assessment.getByText("No local priority reports", { exact: true })).toBeVisible();
  const archive = assessment.getByRole("link", { name: "Browse local reports" });
  await expect(archive).toHaveAttribute("href", "/archive?scope=local");
  await archive.click();
  await expect(page).toHaveURL(/\/archive\?scope=local$/);
  await page.goBack();
  await assessment.getByRole("link", { name: "Flood Warning", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Flood Warning", level: 1, exact: true })).toBeVisible();
  await expect(page.getByText("Scheduled end January 10 at 3:00PM PST")).toBeVisible();
  await page.getByText("Publisher’s full headline", { exact: true }).click();
  await expect(page.getByText(warning.title, { exact: true })).toBeVisible();
});
