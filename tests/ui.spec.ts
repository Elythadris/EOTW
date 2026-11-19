import { expect, test, type Page } from "@playwright/test";
import type { IntelEvent, Preferences } from "../src/types";

const event: IntelEvent = {
  id: "fixture-report",
  bulletinCount: 2,
  bulletins: [
    {
      id: "notice-west",
      location: "Western test zone",
      url: "https://example.org/west",
    },
    {
      id: "notice-east",
      location: "Eastern test zone",
      url: "https://example.org/east",
    },
  ],
  title: "Test bulletin for Maui",
  summary: "A controlled bulletin for testing the reading and saving flow.",
  url: "https://example.org/bulletin",
  source: "Fixture agency",
  publishedAt: "2026-01-14T12:00:00Z",
  updatedAt: "2026-01-14T12:05:00Z",
  category: "Weather",
  scope: "local",
  location: "Maui",
  lat: 20.8,
  lon: -156.4,
  status: "confirmed",
  severity: "routine",
  sources: [{ name: "Fixture agency", url: "https://example.org/bulletin" }],
  timeline: [{ at: "2026-01-14T12:05:00Z", text: "Published update" }],
  intelligence: {
    score: 79,
    level: "elevated",
    category: "Weather",
    why: "A test advisory affects the monitored area.",
    monitor: "Watch for the next agency bulletin.",
    reasons: ["Published agency warning"],
    changeKey: "test-initial",
    axes: { credibility: 10, urgency: 8 },
  },
  rank: 1,
  rankReasons: ["Recently published"],
};
async function mockAPI(
  page: Page,
  events: IntelEvent[] = [event],
  pageSize = 100,
  asOf?: string,
) {
  const scan = asOf || new Date().toISOString();
  let prefs: Preferences = {
    saved: [],
    topics: [],
    location: "Maui",
    notifications: false,
    history: [],
  };
  await page.route("**/api/preferences", async (r) => {
    if (r.request().method() === "PUT") prefs = r.request().postDataJSON();
    await r.fulfill({
      json: { ...prefs, account: { enabled: false, signedIn: false } },
    });
  });
  await page.route("**/api/feed?**", async (r) => {
    const p = new URL(r.request().url()).searchParams;
    const results = events.filter(
      (e) =>
        (!p.get("id") || p.get("id") === e.id) &&
        (!p.get("type") ||
          p.get("type") === "all" ||
          p.get("type") === e.editorialType) &&
        (!p.get("q") ||
          e.title.toLowerCase().includes(p.get("q")!.toLowerCase())) &&
        (!p.get("scope") || ["all", e.scope].includes(p.get("scope")!)),
    );
    const start = Number(p.get("cursor") || 0);
    const sample = results[0];
    await r.fulfill({
      json: {
        events: results.slice(start, start + pageSize),
        ...(p.get("view") === "signals"
          ? {
              intelligence: {
                scanned: events.length,
                alerts: events.length,
                activeWarnings: events.length,
                lastScan: scan,
                regions: ["local", "us", "global"].map((scope) => ({
                  scope,
                  level: results.some((e) => e.scope === scope)
                    ? "elevated"
                    : "quiet",
                  reason: results.some((e) => e.scope === scope)
                    ? "An agency warning was recorded."
                    : "No qualifying source observations.",
                  eventIds: events
                    .filter((e) => e.scope === scope)
                    .map((e) => e.id),
                  count: events.filter((e) => e.scope === scope).length,
                })),
                escalations: sample
                  ? [
                      {
                        eventId: sample.id,
                        at: scan,
                        description: "The source increased the warning level.",
                      },
                    ]
                  : [],
                anomalies: [],
                baselineNote:
                  "Insufficient historical coverage for this comparison.",
                hotIds: results.map((e) => e.id),
                related: [],
              },
            }
          : {}),
        nextCursor:
          start + pageSize < results.length ? String(start + pageSize) : null,
        updatedAt: scan,
        health: [
          {
            id: "fixture",
            name: "Fixture agency",
            status: "ok",
            lastSuccess: new Date().toISOString(),
          },
        ],
      },
    });
  });
  await page.route("**/api/situation?**", (r) =>
    r.fulfill({
      json: {
        location: new URL(r.request().url()).searchParams.get("location"),
        mode: "sources",
        generatedAt: scan,
        updatedAt: scan,
        stale: false,
        notice: "",
        sections: {
          whatHappened: events.length
            ? [{ text: "The source published a bulletin.", citationIds: ["1"] }]
            : [],
          whyItMatters: [],
          whatToMonitor: [],
        },
        citations: events.length
          ? [
              {
                id: "1",
                eventId: events[0].id,
                title: events[0].title,
                source: events[0].source,
                url: events[0].url,
                publishedAt: events[0].publishedAt,
                scope: events[0].scope,
              },
            ]
          : [],
      },
    }),
  );
  await page.route("**/api/ask", (r) =>
    r.fulfill({
      json: {
        answer: "The bulletin records an update [1].",
        mode: "sources",
        citations: [{ id: "1", title: "Original bulletin", url: event.url }],
      },
    }),
  );
}
async function nav(page: Page, name: string) {
  const mobile = page.getByRole("button", { name: "Open navigation" });
  if (await mobile.isVisible()) await mobile.click();
  await page
    .getByRole("navigation")
    .filter({ visible: true })
    .getByRole("link", { name, exact: true })
    .click();
}
test("open a source-backed story, save it and read its timeline from the watchlist", async ({
  page,
}) => {
  await mockAPI(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Command center", level: 1 }),
  ).toBeVisible();
  await page
    .locator("#priority-signals")
    .getByRole("link", { name: event.title, exact: true })
    .click();
  await expect(page).toHaveURL(/\/story\/fixture-report$/);
  await expect(
    page.getByRole("heading", { name: event.title, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText("Published update", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Source 1 Fixture agency/ }),
  ).toHaveAttribute("href", event.url);
  await page.getByText("View publisher notices (2)", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Eastern test zone" }),
  ).toHaveAttribute("href", "https://example.org/east");
  await page.getByRole("button", { name: "Save story", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Saved to watchlist" }),
  ).toBeVisible();
  const mobile = page.getByRole("button", { name: "Open navigation" });
  if (await mobile.isVisible()) await mobile.click();
  await page
    .getByRole("navigation")
    .filter({ visible: true })
    .getByRole("link", { name: /Watchlist/ })
    .click();
  await expect(page.getByRole("link", { name: event.title })).toBeVisible();
  await page.getByRole("button", { name: "Remove saved story" }).click();
  await expect(
    page.getByRole("heading", { name: "No saved stories yet" }),
  ).toBeVisible();
});
test("search and compare evidence, then follow citations from the assistant", async ({
  page,
}) => {
  await mockAPI(page);
  await page.goto("/investigate");
  await page
    .getByRole("textbox", { name: "Investigation subject" })
    .fill("Maui");
  await page.getByRole("button", { name: "Investigate", exact: true }).click();
  await expect(page).toHaveURL(/q=Maui/);
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Fixture agency" }),
  ).toHaveAttribute("href", event.url);
  await page.getByRole("button", { name: "Ask about the evidence" }).click();
  const pane = page.getByRole("dialog", { name: "Ask EOTW" });
  await pane
    .getByRole("textbox", { name: "Your question" })
    .fill("What did the bulletin document?");
  await pane.getByRole("button", { name: "Send question" }).click();
  await expect(
    pane.getByRole("link", { name: /Original bulletin/ }),
  ).toHaveAttribute("href", event.url);
  await pane.getByRole("button", { name: "Close dialog" }).click();
  await expect(pane).toHaveCount(0);
});
test("read and filter the map, then reach an empty archive on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAPI(page);
  await page.goto("/");
  await nav(page, "Live map");
  await expect(
    page.getByRole("heading", { name: "Mapped reports" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: event.title })).toBeVisible();
  await page.getByRole("button", { name: "Global", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No located reports in this view" }),
  ).toBeVisible();
  await nav(page, "Archive");
  await page
    .getByRole("textbox", { name: "Search the archive" })
    .fill("nothingmatches");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No reports match this view" }),
  ).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    window: window.innerWidth,
  }));
  expect(dimensions.doc).toBeLessThanOrEqual(dimensions.window);
});
test("shows an offline state with an honest retry path when feeds fail", async ({
  page,
}) => {
  await mockAPI(page, []);
  await page.route("**/api/feed?**", (r) =>
    r.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Awaiting published reports" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: event.title })).toHaveCount(0);
});

test("reopens the static reader offline with the last public briefing", async ({
  page,
  context,
}) => {
  await mockAPI(page);
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: event.title }).first(),
  ).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
  });
  await page.unrouteAll({ behavior: "wait" });
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Command center", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText(/Offline\. Showing the last available update/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: event.title }).first(),
  ).toBeVisible();
});

test("archive record types persist across search, pagination and browser history", async ({
  page,
}) => {
  const corrections: IntelEvent[] = [1, 2].map((i) => ({
    ...event,
    id: "correction-" + i,
    title: "Maui bulletin clarification " + i,
    category: "Correction",
    editorialType: "correction",
    supersedes: { name: "Earlier bulletin", url: event.url },
  }));
  await mockAPI(page, [event, ...corrections], 1);
  await page.goto("/archive?q=Maui&scope=local");
  const picker = page.getByRole("combobox", { name: "Record type" });
  await picker.selectOption("correction");
  await expect(page).toHaveURL(/q=Maui&type=correction&scope=local$/);
  await expect(
    page.getByRole("link", { name: corrections[0].title }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: event.title })).toHaveCount(0);
  await page.getByRole("button", { name: "Load more reports" }).click();
  await expect(
    page.getByRole("link", { name: corrections[1].title }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search the archive" })
    .fill("clarification 2");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(
    /q=clarification\+2&type=correction&scope=local$/,
  );
  await expect(
    page.getByRole("link", { name: corrections[1].title }),
  ).toBeVisible();
  await picker.selectOption("prediction");
  await expect(
    page.getByRole("heading", { name: "No matching predictions" }),
  ).toBeVisible();
  await page.goBack();
  await expect(picker).toHaveValue("correction");
  await expect(
    page.getByRole("link", { name: corrections[1].title }),
  ).toBeVisible();
  await page.getByRole("link", { name: corrections[1].title }).click();
  await expect(
    page.getByRole("link", { name: /Report being corrected Earlier bulletin/ }),
  ).toHaveAttribute("href", event.url);
});

test("command center explains and filters source-backed regional signals", async ({
  page,
}) => {
  await mockAPI(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Threat scanner" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Source 1 · " + event.title }),
  ).toHaveAttribute("href", event.url);
  const priorities = page.locator("#priority-signals");
  await priorities.getByRole("button", { name: "Global", exact: true }).click();
  await expect(
    priorities.getByRole("heading", {
      name: "No qualifying signals in this area",
    }),
  ).toBeVisible();
  await priorities.getByRole("button", { name: "Local", exact: true }).click();
  await priorities.getByText("Assessment & sources", { exact: true }).click();
  await expect(
    priorities.getByText(/Watch for the next agency bulletin/),
  ).toBeVisible();
  await expect(
    priorities.getByRole("link", { name: "Original source" }),
  ).toHaveAttribute("href", event.url);
  const monitor = page.getByRole("button", { name: /Escalation monitor/ });
  await monitor.click();
  await expect(
    page.getByText("The source increased the warning level."),
  ).toBeHidden();
  await monitor.click();
  await expect(
    page.getByText("The source increased the warning level."),
  ).toBeVisible();
  await page.getByText("Baseline coverage", { exact: true }).click();
  await expect(
    page.getByText("Insufficient historical coverage for this comparison."),
  ).toBeVisible();
});
test("claim review distinguishes attributed evidence and counterevidence", async ({
  page,
}) => {
  const claim: IntelEvent = {
    ...event,
    category: "Claim",
    status: "speculation",
    source: "Fixture publisher",
    evidence: [
      {
        name: "Source document",
        url: "https://example.org/document",
        finding: "The document records an allegation.",
      },
    ],
    counterevidence: [
      {
        name: "Independent review",
        url: "https://example.org/review",
        finding: "The review disputes the chronology.",
      },
    ],
  };
  await mockAPI(page, [claim]);
  await page.goto("/rabbit-hole");
  await page.getByText("Evidence review", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Counterevidence" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Independent review" }),
  ).toHaveAttribute("href", "https://example.org/review");
  await expect(
    page.getByText(/Independent verification is unresolved/),
  ).toBeVisible();
  await expect(
    page.getByText("Unverified claim", { exact: true }),
  ).toBeVisible();
});

test("regional scanner retrieves signals beyond the first page", async ({
  page,
}) => {
  const globalSignal: IntelEvent = {
    ...event,
    id: "global-fixture",
    title: "Storm warning for a different region",
    scope: "global",
    location: "Test region",
  };
  await mockAPI(page, [event, globalSignal], 1);
  await page.goto("/");
  const priorities = page.locator("#priority-signals");
  await expect(
    priorities.getByRole("link", { name: event.title }),
  ).toBeVisible();
  await expect(
    priorities.getByRole("link", { name: globalSignal.title }),
  ).toHaveCount(0);
  const global = page.locator(".region-cell").filter({
    has: page.getByRole("heading", { name: "Global", exact: true }),
  });
  await global.getByRole("button", { name: /Review signals/ }).click();
  await expect(
    priorities.getByRole("link", { name: globalSignal.title }),
  ).toBeVisible();
  await priorities
    .getByRole("button", { name: "All areas", exact: true })
    .click();
  await priorities.getByRole("button", { name: "Show more signals" }).click();
  await expect(
    priorities.getByRole("link", { name: globalSignal.title }),
  ).toBeVisible();
});

test("old scans retain reports while marking risk and active warnings unknown", async ({
  page,
}) => {
  await mockAPI(
    page,
    [event],
    100,
    new Date(Date.now() - 21 * 60_000).toISOString(),
  );
  await page.goto("/");
  await expect(
    page.locator(".region-state strong").filter({ hasText: "Unknown" }),
  ).toHaveCount(3);
  await expect(page.getByText("Current count unavailable")).toBeVisible();
  await expect(
    page.getByText(/Earlier assessment\. Source conditions may have changed/),
  ).toBeVisible();
  await expect(
    page
      .locator("#priority-signals")
      .getByRole("link", { name: event.title, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Investigate lead report" }).click();
  await expect(page).toHaveURL(/\/story\/fixture-report$/);
});

test("a new scan updates the command center after paging through signals", async ({
  page,
}) => {
  const later = {
    ...event,
    id: "second-fixture",
    title: "Second agency bulletin",
  };
  const reports = [event, later];
  await mockAPI(page, reports, 1);
  await page.goto("/");
  const priorities = page.locator("#priority-signals");
  await priorities.getByRole("button", { name: "Show more signals" }).click();
  await expect(
    priorities.getByRole("link", { name: later.title, exact: true }),
  ).toBeVisible();
  const change = { ...event, id: "new-head", title: "Newly escalated warning" };
  reports.unshift(change);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    priorities.getByRole("link", { name: change.title, exact: true }),
  ).toBeVisible();
});

test("the location picker shows the matching relief and updates the chosen area", async ({ page }) => {
  await mockAPI(page, []);
  await page.goto("/");
  const changeFocus = page.locator(".location-control");
  await changeFocus.click();
  const picker = page.getByRole("dialog", { name: "Set local focus" });
  await expect(picker.getByRole("link", { name: "USGS 3DEP" })).toBeVisible();
  await expect(picker.locator("svg.maui-relief image")).toHaveAttribute("href", /maui-hillshade/);
  await picker.getByRole("textbox", { name: "City, island, or region" }).fill("Seattle");
  await picker.getByRole("button", { name: "Set location" }).click();
  await expect(changeFocus).toContainText("Seattle");
  await changeFocus.click();
  await expect(picker.getByRole("textbox", { name: "City, island, or region" })).toHaveValue("Seattle");
  await expect(picker.locator("svg.maui-relief")).toHaveCount(0);
});
