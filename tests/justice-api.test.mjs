import test from "node:test";
import assert from "node:assert/strict";
import { definitions, fetchProvider } from "../server/feeds/providers.mjs";
import { record } from "../server/feeds/model.mjs";

const provider = definitions({}).find(p => p.id === "justice");
const api = rows => JSON.stringify({metadata:{responseInfo:{status:200}},results:rows});
const row = {
  title:"Agency publishes a statement",url:"https://justice.gov/opa/pr/agency-statement",
  date:"1795089600",changed:'<time datetime="2026-11-19T19:59:29-05:00">1795136369</time>',
  teaser:"<p>A <strong>public</strong> statement. &amp; Follow-up.</p>",
};
const now=Date.parse("2026-11-20T01:06:00Z");
test("official press API preserves existing RSS identity, publication date, revision and attribution",()=>{
  const url = new URL(provider.url);
  assert.equal(url.pathname,"/api/v1/press_releases.json");
  assert.deepEqual(["created","DESC","18","0"],["sort","direction","pagesize","page"].map(k=>url.searchParams.get(k)));
  const normalized=record(provider.parse(api([row]))[0],now);
  const rss=record({source:provider.name,title:row.title,url:"https://www.justice.gov/opa/pr/agency-statement",publishedAt:"Thu, 19 Nov 2026 12:00:00 GMT"},now);
  assert.equal(normalized.id,rss.id);
  assert.equal(normalized.url,rss.url);
  assert.equal(normalized.publishedAt,rss.publishedAt);
  assert.equal(normalized.updatedAt,"2026-11-20T00:59:29.000Z");
  assert.equal(normalized.summary,"A public statement. & Follow-up.");
  assert.equal(normalized.source,provider.name);
  assert.equal(normalized.status,"confirmed");
  assert.equal(provider.parse(api(Array(22).fill(row))).length,18);
  assert.throws(()=>provider.parse('{"metadata":{"responseInfo":{"status":403}},"results":[]}'));
  assert.equal(record(provider.parse(api([{...row,url:"https://justice.gov.invalid/notice"}]))[0],now),null);
});
test("first official API poll discards the RSS validators; subsequent polls use the new response validators",async()=>{
  const first=await fetchProvider(provider,{etag:"old-rss",modified:"Thu, 19 Nov 2026 18:00:00 GMT"},{
    now,fetcher:async (url,init)=>{
      assert.equal(url,provider.url);
      assert.equal(init.headers["If-None-Match"],undefined);
      assert.equal(init.headers["If-Modified-Since"],undefined);
      return new Response(api([row]),{headers:{"etag":"api-etag","last-modified":"Fri, 20 Nov 2026 01:00:00 GMT"}});
    },
  });
  assert.equal(first.events.length,1);
  const second=await fetchProvider(provider,first,{now,fetcher:async (_url,init)=>{
    assert.equal(init.headers["If-None-Match"],"api-etag");
    assert.equal(init.headers["If-Modified-Since"],"Fri, 20 Nov 2026 01:00:00 GMT");
    return new Response(null,{status:304});
  }});
  assert.equal(second.unchanged,true);
});
