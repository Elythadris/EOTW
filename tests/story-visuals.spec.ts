import { expect, test, type Page } from "@playwright/test";
import type { IntelEvent, SourceHealth } from "../src/types";

const first = "2026-01-14T12:00:00Z";
const middle = "2026-01-14T12:30:00Z";
const last = "2026-01-14T14:00:00Z";
const report: IntelEvent = {
  id: "2026-01-14-0123456789abcdef1234",
  title: "Harbor advisory",
  summary: "The agency issued a harbor advisory.",
  url: "https://example.org/advisory",
  source: "National Weather Service",
  publishedAt: first,
  updatedAt: last,
  category: "Weather",
  scope: "local",
  location: "Maui",
  lat: 20.8,
  lon: -156.4,
  severity: "high",
  status: "confirmed",
  sources: [],
  timeline: [
    { at: last, text: "The agency published a final update." },
    { at: middle, text: "The agency updated the advisory area." },
    { at: first, text: "The initial advisory was issued." },
    { at: middle, text: "The publisher added a second notice at the same time." },
  ],
  intelligence: {
    score: 80,
    level: "elevated",
    category: "Weather",
    why: "The advisory covers the harbor.",
    monitor: "Read the next agency update.",
    reasons: ["The publisher assigned likely certainty."],
    changeKey: "harbor-advisory",
    axes: { impact: 25, severity: 20, urgency: 15, credibility: 15, proximity: 5, acceleration: 0 },
  },
  rank: 1,
  rankReasons: [],
};

const receipt = {
  name: "Observation log",
  url: "https://example.org/log",
  finding: "The harbor observer documented the condition.",
};

async function mockSources(page: Page, events: IntelEvent[], health: SourceHealth[] = []) {
  await page.route("**/api/preferences", route => route.fulfill({
    json: { saved: [], topics: [], location: "Maui", notifications: false, history: [], account: { enabled: false, signedIn: false } },
  }));
  await page.route("**/api/feed?**", route => {
    const id = new URL(route.request().url()).searchParams.get("id");
    return route.fulfill({ json: { events: id ? events.filter(event => event.id === id) : events, updatedAt: last, nextCursor: null, health } });
  });
}

test("the time rail follows real dates and keeps simultaneous updates individually accessible", async ({ page }) => {
  await mockSources(page, [report]);
  await page.goto("/story/" + report.id);
  const slider = page.getByRole("slider", { name: "Explore updates by time" });
  const select = page.getByRole("combobox", { name: "Choose timeline update" });
  await expect(slider).toHaveAttribute("min", String(Date.parse(first)));
  await expect(slider).toHaveAttribute("max", String(Date.parse(last)));
  await expect(select.locator("option")).toHaveCount(4);
  await expect(page.getByText(report.timeline[0].text, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next update" })).toBeDisabled();

  await slider.press("ArrowLeft");
  await expect(slider).toHaveValue(String(Date.parse(middle)));
  await expect(page.getByText(report.timeline[3].text, { exact: true })).toBeVisible();
  await slider.press("ArrowLeft");
  await expect(slider).toHaveValue(String(Date.parse(middle)));
  await expect(page.getByText(report.timeline[1].text, { exact: true })).toBeVisible();
  // Thirty minutes into a two-hour range is one quarter of the plotted distance.
  const position = await page.locator(".sv-plot-track .is-selected").evaluate(marker => (marker as HTMLElement).style.left);
  expect(position).toBe("25%");
  await select.selectOption({ index: 0 });
  await expect(page.getByRole("button", { name: "Previous update" })).toBeDisabled();
  const firstEntry = page.getByText(report.timeline[2].text, { exact: true });
  await expect(firstEntry).toBeVisible();
  const disclosure = page.getByText("Recorded update", { exact: true });
  await disclosure.press("Enter");
  await expect(firstEntry).toBeHidden();
  await disclosure.press("Enter");
  await expect(firstEntry).toBeVisible();
  await page.getByRole("button", { name: "Next update" }).click();
  await expect(page.getByText(report.timeline[1].text, { exact: true })).toBeVisible();
});

test("all six score scales, tier thresholds and source caps remain readable with partial historical data", async ({ page }) => {
  const historical: IntelEvent = {
    ...report,
    id: "2026-01-14-abcdef0123456789abcd",
    intelligence: { ...report.intelligence!, axes: { acceleration: 0 } },
  };
  await mockSources(page, [report, historical]);
  await page.goto("/story/" + report.id);
  const factors = page.getByRole("list", { name: "Six priority score factors" }).getByRole("listitem");
  await expect(factors).toHaveText([
    /Impact\s*25\s*\/\s*30/, /Severity\s*20\s*\/\s*20/, /Urgency\s*15\s*\/\s*20/,
    /Credibility\s*15\s*\/\s*15/, /Proximity\s*5\s*\/\s*5/, /Acceleration\s*0\s*\/\s*10/,
  ]);
  const bands = page.getByLabel("Score bands");
  for (const band of ["Below threshold 0–39", "Watch 40–62", "Elevated 63–78", "High 79–100"]) {
    await expect(bands.getByText(band, { exact: true })).toBeVisible();
  }
  await expect(page.getByText(/published assessment is capped at elevated/)).toBeVisible();
  await expect(page.getByText(/High requires an immediate warning/)).toBeVisible();
  await expect(page.getByRole("link", { name: "National Weather Service", exact: true })).toHaveAttribute("href", report.url);
  await page.goto("/story/" + historical.id);
  await expect(factors.filter({ hasText: "Unavailable" })).toHaveCount(5);
  await expect(factors.filter({ hasText: "Impact" })).toHaveText(/Unavailable\s*\/\s*30/);
  await expect(factors.filter({ hasText: "Acceleration" })).toHaveText(/0\s*\/\s*10/);
});

test("evidence counts include distinct attributed findings and label both missing states", async ({ page }) => {
  const claim: IntelEvent = {
    ...report, category: "Claim", status: "speculation", topicClaim: true,
    evidence: [receipt, receipt, { ...receipt, name: "Unlinked note", url: "" }, { ...receipt, finding: "  " }],
    counterevidence: [],
  };
  const empty: IntelEvent = { ...claim, id: "2026-01-14-eeeeeeeeeeeeeeeeeeee", title: "Second harbor claim", evidence: [] };
  await mockSources(page, [claim, empty]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/rabbit-hole");
  const review = page.getByRole("article").filter({ has: page.getByRole("link", { name: claim.title, exact: true }) });
  const emptyReview = page.getByRole("article").filter({ has: page.getByRole("link", { name: empty.title, exact: true }) });
  await expect(review.locator("summary .sv-evidence-count")).toHaveText([/1\s*Supporting finding$/, /0\s*Contrary findings$/]);
  await review.getByText("Evidence review", { exact: true }).click();
  await expect(review.locator(".sv-card-body")).toHaveCSS("animation-name", "none");
  await expect(review.getByRole("link", { name: receipt.name })).toHaveCount(1);
  await expect(review.getByRole("link", { name: receipt.name })).toHaveAttribute("href", receipt.url);
  await expect(review.getByText(receipt.finding, { exact: true })).toHaveCount(1);
  await expect(review.getByText("No contrary findings are indexed.", { exact: true })).toBeVisible();
  await expect(review.getByRole("link", { name: "Unlinked note" })).toHaveCount(0);
  await emptyReview.getByText("Evidence review", { exact: true }).click();
  await expect(emptyReview.getByText("No supporting findings are indexed.", { exact: true })).toBeVisible();
  await expect(emptyReview.getByText("No contrary findings are indexed.", { exact: true })).toBeVisible();
});

test("source health filters count available, failed, pending and disabled providers", async ({ page }) => {
  const providers: SourceHealth[] = [
    { id: "a", name: "Harbor office", status: "ok", lastSuccess: last },
    { id: "b", name: "Coastal station", status: "error", lastSuccess: first, detail: "Publisher request timed out." },
    { id: "c", name: "Island registry", status: "pending", lastSuccess: null },
    { id: "d", name: "Inactive wire", status: "disabled", lastSuccess: null },
  ];
  await mockSources(page, [], providers);
  await page.goto("/sources");
  const coverage = page.getByRole("region", { name: "Source coverage" });
  const filters = coverage.getByRole("group", { name: "Filter providers by status" });
  await expect(coverage.getByText(/enabled sources healthy/)).toHaveText(/1\s*\/\s*3\s*enabled sources healthy/);
  for (const [name, provider] of [["Healthy", providers[0]], ["Unavailable", providers[1]], ["Pending", providers[2]], ["Disabled", providers[3]]] as const) {
    const button = filters.getByRole("button", { name: name + " 1", exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(coverage.getByRole("heading", { level: 3 })).toHaveText([provider.name]);
  }
  await filters.getByRole("button", { name: "All 4", exact: true }).click();
  await expect(coverage.getByRole("heading", { level: 3 })).toHaveText(providers.map(provider => provider.name));
});


test("the expandable assessment follows citations and refreshes a revised story without navigation", async ({ page }) => {
  await page.clock.install();
  const records = [{ ...report }];
  await mockSources(page, records);
  const requests: string[] = [];
  await page.route("**/api/assessment?**", route => {
    const query = new URL(route.request().url()).searchParams;
    requests.push(query.get("id") || "");
    const revised = records[0].updatedAt !== last;
    return route.fulfill({ json: {
      eventId: report.id, mode: revised ? "sources" : "ai", updatedAt: records[0].updatedAt,
      notice: revised ? "Review of the updated bulletin." : "The model selected explanations to examine.",
      facts: [{text: "The agency published the advisory.", citationIds:["1"]}], allegations: [],
      significance: [], implications: [], unknowns:["The duration is unknown."], watch: [],
      hypotheses:[{ label:"Reported harbor conditions", explanation:"Check whether conditions changed.",
        support:[{text:"The notice includes an observation.",citationIds:["1"]}], against:[], test:"Read the next bulletin." }],
      citations:[{id:"1",title:"Publisher advisory",source:report.source,url:report.url}],
    }});
  });
  await page.goto("/story/" + report.id);
  const disclosure = page.locator(".event-investigation").filter({hasText:"Intelligence assessment"});
  await expect(disclosure).toBeVisible();
  expect(requests).toHaveLength(0);
  await disclosure.locator("summary").click();
  await expect(disclosure.getByText("AI-assisted assessment", {exact:true})).toBeVisible();
  await expect(disclosure.getByText("No contrary evidence is indexed for this explanation.")).toBeVisible();
  await expect(disclosure.getByRole("link", {name:/Source 1, National Weather Service/}).first()).toHaveAttribute("href", report.url);
  records[0] = {...report, updatedAt:"2026-01-14T14:30:00Z"};
  await page.clock.fastForward(45_500);
  await expect(disclosure.getByText("Source-based assessment", {exact:true})).toBeVisible();
  await expect(disclosure.getByText("Review of the updated bulletin.")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(report.id+"$"));
  expect(requests).toEqual([report.id, report.id]);
});

test("Hot 24 reorders on a polling tick and keeps expired editions out of the list", async ({ page }) => {
  const now = new Date("2026-01-14T15:00:00Z");
  await page.clock.install({time:now});
  const current = {...report, hotAt:"2026-01-14T14:00:00Z",rankReasons:["Publisher warning still in force."]};
  const expired = {...current,id:"old-report",title:"Expired edition",hotAt:"2026-01-13T14:59:59Z"};
  const rows = [expired,current];
  await mockSources(page, rows);
  await page.goto("/trending");
  await expect(page.getByRole("link", {name:current.title})).toBeVisible();
  await expect(page.getByRole("link", {name:expired.title})).toHaveCount(0);
  await page.getByText("Assessment & sources",{exact:true}).click();
  await expect(page.getByRole("list", {name:"Ranking reasons"})).toContainText(current.rankReasons[0]);
  rows.unshift({...current,id:"new-report",title:"New advisory update",hotAt:"2026-01-14T15:00:30Z"});
  await page.clock.fastForward(45_500);
  await expect(page.locator(".sv-priority-card h3").first()).toHaveText("New advisory update");
  await expect(page.getByRole("link", {name:expired.title})).toHaveCount(0);
});
