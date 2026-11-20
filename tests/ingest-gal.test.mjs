import test from "node:test";
import assert from "node:assert/strict";
import { ranked, record } from "../server/feeds/model.mjs";
import { galArticles, galBytes, galUrl } from "../server/feeds/gal.mjs";
import { fetchProvider, definitions } from "../server/feeds/providers.mjs";
const date = "19 Nov 2026 12:10:00 +0000";
const now = Date.parse(date);
const provider = definitions({}).find((p) => p.id === "gdelt");
const item = (url, title) => "<item><title>"+title+"</title><link>"+url+"</link><pubDate>"+date+"</pubDate></item>";
const prefix = "<rss><channel><title>GDELT Article List RSS Feed</title>"
  + item("https://example.org/one","Ceasefire talks continue")
  + item("https://example.org/one","Ceasefire talks continue")
  + item("https://example.org/two","Election results certified")
  + item("https://example.org/three","Another wildfire update")
  + item("https://another.example/review","New album review")
  + item("https://another.example/hurricane","Hurricane watch issued")
  + "<item><title>Unfinished";
test("bounded GDELT Article List discovery preserves publisher metadata and excludes partial items", () => {
  const found = galArticles(prefix);
  assert.equal(found.length, 3);
  assert.equal(found[0].url, "https://example.org/one");
  assert.equal(found[0].source, "example.org");
  assert.equal(found[0].publishedAt, date);
  const discovery = ranked(record(found[0],now),now,"Maui");
  assert.ok(discovery.rankReasons.includes("Discovered by GDELT within 24 hours"));
  assert.ok(discovery.rankReasons.every(reason => !reason.includes("Source updated")));
  assert.throws(() => galArticles("<html>Blocked</html>"));
});
test("GDELT DOC throttling uses bounded fallback, preserves validators and honours Retry-After", async () => {
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push(url);
    if (url === provider.url) return new Response(null, { status: 429, headers: { "Retry-After": "3600" } });
    assert.equal(init.headers.Range, "bytes=0-" + (galBytes - 1));
    return new Response(prefix, { status: 206, headers: { ETag: '"sample"', "Content-Range": "bytes 0-81919/200000" } });
  };
  const batch = await fetchProvider(provider, { etag: "doc-validator" }, { fetcher, now });
  assert.deepEqual(seen, [provider.url, galUrl]);
  assert.equal(batch.etag, "doc-validator");
  assert.equal(batch.galEtag, '"sample"');
  assert.equal(batch.events.length, 3);
  assert.match(batch.detail, /DOC unavailable/);
  assert.ok(batch.primaryRetryAfter > Date.now());
  await fetchProvider(provider, { primaryRetryAfter: now + 3600000, galEtag: batch.galEtag },
    { now, fetcher: async (url, init) => {
      assert.equal(url, galUrl);
      assert.equal(init.headers["If-None-Match"], '"sample"');
      return new Response(null, { status: 304 });
    } });
});
test("refuses an unbounded full-file response", async () => {
  await assert.rejects(fetchProvider(provider, { primaryRetryAfter: now + 3600000 }, {
    now, fetcher: async () => new Response("full dataset", { headers: { "Content-Length": "2000000" } }),
  }), /bounded request/);
});

test("a quota on GDELT DOC does not postpone recovery of its independent Article List", async () => {
  const primaryRetryAfter=now+2*3600_000;
  await assert.rejects(fetchProvider(provider,{primaryRetryAfter},{
    now,fetcher:async url=>{
      assert.equal(url,galUrl);
      return new Response(null,{status:404});
    },
  }),error=>error.status===404 && error.primaryRetryAfter===primaryRetryAfter && !error.retryAfter);
});
