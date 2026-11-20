import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const origin = "https://eotw-watch.netlify.app";
await mkdir("qa/empty",{recursive:true});
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  let mainNavigations = 0;
  page.on("framenavigated", frame => { if (frame === page.mainFrame()) mainNavigations++; });
  const seen = [];
  page.on("response", async response => {
    const url = new URL(response.url());
    if (url.pathname !== "/api/feed" || url.searchParams.get("view") !== "trending" || !response.ok()) return;
    try {
      const data = await response.json();
      seen.push({scan:data.updatedAt, count:data.total, liveIds:data.events.map(e=>e.id)});
    } catch {}
  });
  // A real foreground browser stays on the ordinary Hot 24 URL throughout.
  // No route mocking, clock changes, manual refreshes or injected browser events.
  await page.goto(origin + "/trending");
  const freshness = page.locator(".freshness time[datetime]");
  await freshness.waitFor();
  await page.locator(".sv-priority-card h3 a").first().waitFor();
  const initial = await freshness.getAttribute("datetime");
  const beforeCards=await page.locator(".sv-priority-card h3 a").evaluateAll(links=>links.map(l=>({href:l.getAttribute("href"),title:l.textContent})));
  const storyTab=await browser.newPage();
  const story="/story/2026-11-19-10133cd5512447b271b9";
  await storyTab.goto(origin+story);
  const investigation=storyTab.locator("details.event-investigation").first();
  await investigation.locator("summary").click();
  await investigation.getByRole("heading",{name:"What the sources establish"}).waitFor({timeout:30000});
  const productionAssessment={story,mode:await investigation.locator(".investigation-mode strong").innerText(),
    headings:await investigation.locator("h4").allTextContents(),labels:await investigation.locator(".hypothesis-origin").allTextContents(),
    citations:[...new Set(await investigation.locator(".assessment-cite").evaluateAll(links=>links.map(l=>l.getAttribute("href"))))]};
  assert.equal(productionAssessment.mode,"AI-assisted assessment");
  assert(productionAssessment.citations.some(url=>url.startsWith("https://api.weather.gov/alerts/")));
  assert(productionAssessment.headings.includes("What remains unknown"));
  await storyTab.close();

  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  const script = await page.locator("script[type=module][src]").getAttribute("src");
  console.log("Waiting for the open Hot 24 page to advance from " + initial);
  await page.waitForFunction(initial => {
    const current = document.querySelector(".freshness time")?.dateTime;
    return Date.parse(current) > Date.parse(initial);
  },initial,{timeout:735_000,polling:1500});
  const updated = await freshness.getAttribute("datetime");
  const firstId = (await page.locator(".sv-priority-card h3 a").first().getAttribute("href")).split("/").at(-1);
  assert.equal(mainNavigations,1);
  assert.equal(await page.evaluate(()=>performance.timeOrigin), timeOrigin);
  assert.equal(await page.locator("script[type=module][src]").getAttribute("src"),script);
  assert(seen.some(s=>s.scan === initial));
  assert(seen.some(s=>s.scan === updated && s.liveIds.includes(firstId)));
  let recent = [];
  for (let attempt = 0; attempt < 7; attempt++) {
    const telemetry = await (await page.request.get(origin+"/api/feed?view=signals&scope=all&location=Maui&limit=1")).json();
    recent = telemetry.recentScans || [];
    if (recent.some(s=>s.startedAt === updated && s.succeeded > 0 && s.nextScheduledAt)) break;
    await new Promise(resolve=>setTimeout(resolve,8000));
  }
  assert(recent.some(s=>s.startedAt === updated && s.succeeded > 0 && s.nextScheduledAt));
  const checked = recent.find(s=>s.exampleArchivedId);
  let archived = null;
  if (checked) {
    const response = await page.request.get(origin+"/api/feed?view=archive&id="+checked.exampleArchivedId);
    assert(response.ok());
    const result = await response.json();
    assert(result.events.some(e => e.id === checked.exampleArchivedId || e.bulletins?.some(b=>b.id === checked.exampleArchivedId)));
    archived = checked.exampleArchivedId;
  }
  const afterCards=await page.locator(".sv-priority-card h3 a").evaluateAll(links=>links.map(l=>({href:l.getAttribute("href"),title:l.textContent})));
  const changedCards=[...new Set([...beforeCards,...afterCards].filter(c=>!beforeCards.some(b=>b.href===c.href && b.title===c.title) || !afterCards.some(a=>a.href===c.href && a.title===c.title)).map(c=>c.href))];
  const evidence = {changedCards,productionAssessment,verifiedAt:new Date().toISOString(),page:origin+"/trending",before:initial,after:updated,
    documentNavigations:mainNavigations,unchangedScript:script,rankedReports:seen.at(-1).count,
    visibleReport:firstId,checkedArchivedRecord:archived,scheduledRuns:recent.slice(0,2) };
  await mkdir("verification",{recursive:true});
  await writeFile("verification/result.json",JSON.stringify(evidence,null,2));
  await writeFile("verification/index.html","<!doctype html><title>EOTW production verification</title><a href='/result.json'>Read the live verification record</a>");
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); }
