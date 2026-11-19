import { test } from "node:test";
import assert from "node:assert/strict";
import { storyHandler, sitemapHandler } from "../server/assistant/seo.mjs";

const id = "2026-01-21-0123456789abcdef0123";
const production = {
  site: { url: "https://briefing.example" },
  deploy: { context: "production" },
};
const preview = { ...production, deploy: { context: "deploy-preview" } };
const event = {
  id,
  title: "Review <draft> & notes",
  summary: 'A statement "$&</head>"',
  url: "https://publisher.example/report?q=a&b=c",
  source: "Observatory",
  publishedAt: "2026-01-21T00:00:00Z",
};
const shell = async () =>
  '<html><head><title>Home</title><meta content="old" name="description"><link rel="canonical" href="https://old.example"></head><body><div id="root"></div><script type="module" src="/assets/app-123.js"></script></body></html>';
const request = (path, method = "GET") =>
  new Request("https://briefing.example" + path, { method });

test("story HTML keeps current SPA assets, escapes source content and points to the production URL", async () => {
  const handler = storyHandler(async () => ({ events: [event] }), shell);
  const rendered = await handler(request("/story/" + id), production);
  assert.equal(rendered.status, 200);
  const html = await rendered.text();
  assert.match(html, /\/assets\/app-123\.js/);
  assert.match(
    html,
    /<title>Review &lt;draft&gt; &amp; notes \| EOTW<\/title>/,
  );
  assert.match(html, /A statement &quot;\$&amp;&lt;\/head&gt;&quot;/);
  assert.match(html, /Read the original report from Observatory/);
  assert.match(html, /q=a&amp;b=c/);
  assert.match(html, /https:\/\/briefing.example\/story\//);
  assert.equal((html.match(/name="description"/g) || []).length, 1);
  assert.doesNotMatch(html, /old.example|<draft>/);
  const draft = await handler(request("/story/" + id), preview);
  assert.equal(draft.headers.get("x-robots-tag"), "noindex");
  assert.doesNotMatch(await draft.text(), /rel="canonical"/);
  const head = await handler(request("/story/" + id, "HEAD"), production);
  assert.equal(await head.text(), "");
});

test("an unknown story returns 404 and an unavailable archive returns retryable 503", async () => {
  const absent = storyHandler(
    async () => ({ events: [], updatedAt: "2026-01-21T00:00:00Z" }),
    shell,
  );
  assert.equal((await absent(request("/story/" + id), production)).status, 404);
  assert.equal((await absent(request("/story/bad"), production)).status, 404);
  const down = storyHandler(async () => {
    throw Error("Unavailable");
  }, shell);
  const res = await down(request("/story/" + id), production);
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("retry-after"), "60");
});

test("sitemaps list public routes and all available daily shards with safe canonical URLs", async () => {
  const handler = sitemapHandler({
    pages: ["/", "/archive"],
    days: async () => ["2026-01-21", "bad"],
    stories: async (day) => (day === "2026-01-21" ? [event] : null),
  });
  const index = await handler(request("/sitemap.xml"), production);
  assert.match(await index.text(), /sitemap\.xml\?day=2026-01-21/);
  assert.equal(index.headers.get("netlify-vary"), "query=part|day");
  const shard = await handler(
    request("/sitemap.xml?day=2026-01-21"),
    production,
  );
  assert.match(await shard.text(), new RegExp(id));
  const pages = await handler(request("/sitemap.xml?part=pages"), production);
  assert.match(await pages.text(), /briefing.example\/archive<\/loc>/);
  assert.equal(
    (await handler(request("/sitemap.xml?day=missing"), production)).status,
    404,
  );
  assert.doesNotMatch(
    await (await handler(request("/sitemap.xml"), preview)).text(),
    /briefing.example/,
  );
});
