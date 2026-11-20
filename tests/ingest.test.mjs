import test from "node:test";
import assert from "node:assert/strict";
import { record, ranked, link, DAY, HOUR } from "../server/feeds/model.mjs";
import { usgs, nws, rss, fetchProvider, definitions } from "../server/feeds/providers.mjs";
import { collect, searchEvents, SNAPSHOT_KEY } from "../server/feeds/store.mjs";
import { createFeedHandler } from "../netlify/functions/feed.mjs";

const clock = Date.parse("2026-04-15T12:00:00Z");
const fixture = (extra = {}) =>
  record(
    {
      title: "Maui water authority issues a source bulletin",
      url: "https://example.org/bulletin",
      publishedAt: clock - HOUR,
      source: "Test source",
      scope: "us",
      category: "County bulletin",
      status: "confirmed",
      ...extra,
    },
    clock,
  );
function memory() {
  const rows = new Map();
  return {
    async get(key) {
      return structuredClone(rows.get(key)?.data || null);
    },
    async getWithMetadata(key) {
      return structuredClone(rows.get(key) || null);
    },
    async setJSON(key, data, opts = {}) {
      const prev = rows.get(key);
      if (
        (opts.onlyIfNew && prev) ||
        (opts.onlyIfMatch && opts.onlyIfMatch !== prev?.etag)
      )
        return { modified: false };
      rows.set(key, {
        data: structuredClone(data),
        etag: String(Number(prev?.etag || 0) + 1),
      });
      return { modified: true };
    },
  };
}
const def = { id: "source", name: "Fixture source", minutes: 5 };
test("canonical URLs, upstream timestamps and safe mapping are required", () => {
  assert.equal(link("javascript:alert(0)"), "");
  assert.equal(
    link("https://example.org/report?utm_source=test#heading"),
    "https://example.org/report",
  );
  assert.equal(fixture({ publishedAt: null }), null);
  assert.equal(fixture({ publishedAt: clock + DAY }), null);
  assert.equal(fixture({ coords: [12, 42] }).lat, null);
  assert.equal(fixture({ natural: true, coords: [null, 42] }).lon, null);
  assert.equal(fixture({ natural: true, coords: [12, 42] }).lat, 42);
  assert.equal(
    fixture({ summary: "<script>bad()</script>Good  text" }).summary,
    "Good text",
  );
});
test("broad markers identify reporting jurisdictions and avoid ambiguous places", () => {
  const tagged = fixture({
    title: "An election report",
    placeTags: ["Elections", "Georgia"],
  });
  assert.equal(tagged.coordinatePrecision, "country");
  assert.match(tagged.mapNote, /Georgia/);
  assert.equal(
    fixture({ title: "Ceasefire talks in Ukraine", category: "World" })
      .category,
    "Conflict reporting",
  );
  assert.equal(
    fixture({ title: "Ceasefire talks in Ukraine", category: "World" })
      .coordinatePrecision,
    "country",
  );
  assert.equal(
    fixture({ title: "Trade talks in France and Germany" }).lat,
    null,
  );
  assert.equal(
    fixture({ title: "A report from London", placeTags: ["France", "Germany"] })
      .lon,
    null,
  );
  assert.equal(fixture({ title: "News conference in Georgia" }).lat, null);
  assert.equal(fixture({ country: "US" }).coordinatePrecision, "country");
  assert.equal(fixture({ county: "15009" }).coordinatePrecision, "region");
});
test("real provider field shapes respect verification and significance", () => {
  const quake = usgs(
    JSON.stringify({
      features: [
        {
          geometry: { type: "Point", coordinates: [-156, 20, 5] },
          properties: {
            title: "Reported earthquake",
            url: "https://example.org/quake",
            place: "South of Maui, Hawaii",
            time: clock - 1000,
            updated: clock,
            status: "automatic",
            mag: 6.1,
            felt: 12,
          },
        },
      ],
    }),
  )[0];
  const rankedQuake = ranked(record(quake, clock), clock, "Maui");
  assert.equal(rankedQuake.status, "developing");
  assert.equal(rankedQuake.scope, "local");
  assert.equal(rankedQuake.severity, "high");
  assert.equal(rankedQuake.lat, 20);
  assert.ok(rankedQuake.rankReasons.includes("12 USGS felt reports"));
  assert.deepEqual(nws('{"features":[]}'), []);
  assert.throws(() => nws("{}"), /Unexpected/);
  assert.throws(() => rss("<html>blocked</html>", {}), /Invalid/);
  assert.throws(() => rss("<!DOCTYPE data><rss/>", {}), /XML declaration/);
  const feed = rss(
    "<rss><channel><title>County</title><item><title>Water update</title><link>https://example.org/water</link><pubDate>Tue, 14 Apr 2026 15:00:00 GMT</pubDate></item></channel></rss>",
    { name: "County", official: true },
  );
  assert.equal(feed[0].title, "Water update");
});
test("fetch preserves validators, treats not modified correctly, honors provider quota", async () => {
  const p = { id: "up", url: "https://example.org", parse: () => [] };
  let seen;
  const result = await fetchProvider(
    p,
    { etag: "abc" },
    {
      fetcher: async (_url, init) => {
        seen = init;
        return new Response(null, { status: 304 });
      },
    },
  );
  assert.equal(seen.headers["If-None-Match"], "abc");
  assert.equal(result.unchanged, true);
  let attempts = 0;
  await assert.rejects(
    fetchProvider(
      p,
      {},
      {
        fetcher: async () => {
          attempts++;
          return new Response(null, {
            status: 429,
            headers: { "Retry-After": "7200" },
          });
        },
      },
    ),
    (e) => e.status === 429 && e.retryAfter > Date.now() + HOUR,
  );
  assert.equal(attempts, 1);
});
test("successful collection deduplicates, records editions, and degrades independently on failure", async () => {
  const store = memory();
  const defs = [def];
  const first = fixture(),
    next = fixture({ summary: "Water service is restored.", updatedAt: clock });
  const run = (now, load) => collect({ store, defs, now, load });
  await run(clock, async () => ({ events: [first, first] }));
  assert.equal((await run(clock, async () => assert.fail())).busy, true);
  await run(clock + 5 * 60000, async () => ({ events: [next] }));
  const at = clock + 10 * 60000;
  await run(at, async () => {
    throw Error("offline");
  });
  const response = await searchEvents(
    { scope: "local", q: "water" },
    { store, defs, now: at },
  );
  assert.equal(response.events.length, 1);
  assert.equal(response.events[0].summary, next.summary);
  assert.equal(response.health[0].status, "error");
  assert.equal(
    response.health[0].lastSuccess,
    new Date(clock + 5 * 60000).toISOString(),
  );
  assert.equal(response.updatedAt, response.health[0].lastSuccess);
  assert.ok(
    response.events[0].timeline.some((item) =>
      item.text.startsWith("Prior edition"),
    ),
  );
  const archive = await searchEvents(
    { view: "archive", q: "restored" },
    { store, defs, now: at },
  );
  assert.equal(archive.events[0].id, first.id);
});
test("active replacements expire, history and detail persist, archive paginates", async () => {
  const store = memory(),
    defs = [{ ...def, replace: true }];
  const first = fixture({ expiresAt: clock + 60000 }),
    second = fixture({
      url: "https://example.org/next",
      publishedAt: clock - DAY * 2,
      title: "Another update",
    });
  await collect({
    store,
    defs,
    now: clock,
    load: async () => ({ events: [first, second] }),
  });
  const ask = (params) =>
    searchEvents(params, { store, defs, now: clock + 120000 });
  assert.equal((await ask({ view: "trending" })).events.length, 0);
  const page = await ask({ view: "archive", limit: 1 });
  assert.equal(page.events[0].id, first.id);
  assert.equal(
    (await ask({ view: "archive", limit: 1, cursor: page.nextCursor }))
      .events[0].id,
    second.id,
  );
  await collect({
    store,
    defs,
    now: clock + 300000,
    load: async () => ({ events: [] }),
  });
  assert.equal((await ask({})).events.length, 0);
  assert.equal((await ask({ id: first.id })).events[0].id, first.id);
});
test("discussion data expires and stays outside the durable archive", async () => {
  const store = memory(),
    defs = [{ ...def, id: "reddit", replace: true, transient: true }];
  const post = fixture({
    source: "Reddit",
    topicClaim: true,
    transient: true,
    status: "speculation",
  });
  await collect({
    store,
    defs,
    now: clock,
    load: async () => ({ events: [post] }),
  });
  const ask = (view, now) => searchEvents({ view }, { store, defs, now });
  assert.equal((await ask("rabbit", clock)).events.length, 1);
  assert.equal((await ask("archive", clock)).events.length, 0);
  assert.equal((await ask("briefing", clock)).events.length, 0);
  assert.equal((await ask("rabbit", clock + HOUR)).events.length, 0);
});
test("endpoint validates methods, query bounds, cache variation and storage failures", async () => {
  const fn = createFeedHandler(async (p) => ({
    events: [],
    health: [],
    updatedAt: null,
    nextCursor: null,
    location: p.location,
  }));
  const call = (query = "", method = "GET") =>
    fn(new Request("https://example.org/api/feed" + query, { method }));
  assert.equal((await call("?limit=NaN")).status, 400);
  assert.equal((await call("?id=../secret")).status, 400);
  assert.equal((await call("?view=bad")).status, 400);
  assert.equal((await call("", "POST")).status, 405);
  const response = await call("?location=Lahaina");
  assert.equal((await response.json()).location, "Lahaina");
  assert.equal(response.headers.get("Netlify-Vary"), "query");
  assert.equal(
    (await call("?view=rabbit")).headers.get("Cache-Control"),
    "no-store",
  );
  const down = createFeedHandler(async () => {
    throw new Error("test");
  });
  assert.equal(
    (await down(new Request("https://example.org/api/feed"))).status,
    503,
  );
  const store = memory();
  await store.setJSON(SNAPSHOT_KEY, { version: 999 });
  await assert.rejects(searchEvents({}, { store, defs: [] }), /schema/);
});

test("existing DOC backoff permits one independent fallback check after upgrade", async () => {
  const store = memory();
  const due = clock + 30 * 60_000;
  await store.setJSON(SNAPSHOT_KEY, {
    version: 1, events: [], days: [], updatedAt: null,
    providers: { gdelt: { status: "error", ids: [], nextDue: due, lastSuccess: null } },
  });
  let calls = 0;
  const result = await collect({
    store, now: clock, defs: [{ id: "gdelt", name: "GDELT", minutes: 30 }],
    load: async (_definition, state) => {
      calls++;
      assert.equal(state.primaryRetryAfter, due);
      return { events: [], primaryRetryAfter: due, detail: "Article List fallback" };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.succeeded, 1);
  const state = await store.get(SNAPSHOT_KEY);
  assert.equal(state.providers.gdelt.primaryRetryAfter, due);
});

test("ten-minute scans align to UTC, write receipts, and isolate rate-limited and failing publishers", async () => {
  const { config } = await import("../netlify/functions/collect.mjs");
  assert.equal(config.schedule, "*/10 * * * *");
  assert.ok(definitions({}).every(source => source.minutes === 10));
  const store=memory();
  const minute=60_000;
  const defs=[
    {id:"healthy", name:"Healthy", minutes:10},
    {id:"limited", name:"Limited", minutes:10},
    {id:"offline", name:"Offline", minutes:10},
    {id:"disabled", name:"Off", minutes:10,disabled:"Turned off"},
  ];
  // Existing production data may still advertise a six-hour next check.
  await store.setJSON(SNAPSHOT_KEY, {
    version:1, events:[], days:[], providers:{
      healthy:{status:"ok",lastSuccess:new Date(clock-12*minute).toISOString(),
        lastAttempt:new Date(clock-12*minute).toISOString(),nextDue:clock+6*HOUR,ids:[]},
    },updatedAt:null,
  });
  const nextScheduledAt=new Date(clock+10*minute).toISOString();
  const item=fixture();
  const checks=[];
  const load=source=>{
    checks.push(source.id);
    if (source.id==="limited") throw Object.assign(new Error("Throttled"),{status:429,retryAfter:clock+25*minute});
    if (source.id==="offline") throw new Error("Unavailable");
    return {events:[item]};
  };
  const first=await collect({store,defs,now:clock+12000,load,nextScheduledAt});
  assert.deepEqual(checks,["healthy","limited","offline"]);
  assert.equal(first.succeeded,1);
  assert.equal(first.failed,2);
  assert.equal(first.exampleArchivedId,item.id);
  assert.equal(first.archiveDays,1);
  assert.equal(first.nextScheduledAt,nextScheduledAt);
  const partition=await store.get("v1/days/"+item.id.slice(0,10));
  assert.ok(partition.some(row=>row.id===first.exampleArchivedId));

  checks.length=0;
  const second=await collect({store,defs,now:clock+10*minute+1000,load});
  assert.deepEqual(checks,["healthy","offline"]);
  assert.equal(second.deferred,1);
  assert.equal(second.changed,0);
  const at=clock+20*minute+2000;
  const third=await collect({store,defs,now:at,load:()=>{throw new Error("offline");}});
  const feed=await searchEvents({view:"signals"},{store,defs,now:at});
  assert.deepEqual(feed.recentScans.map(s=>s.startedAt),[third,second,first].map(s=>s.startedAt));
  assert.equal(feed.intelligence.lastScan,second.startedAt);
  assert.equal(third.succeeded,0);
  assert.equal(third.exampleArchivedId,null);
  assert.equal(feed.health.find(s=>s.id==="limited").nextAttemptAt,new Date(clock+25*minute).toISOString());
});
