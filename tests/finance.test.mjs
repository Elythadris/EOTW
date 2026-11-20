import assert from "node:assert/strict";
import test from "node:test";
import { marketSeries,loadFinance,financeEvidence } from "../server/finance/market.mjs";
import { financeHandler } from "../netlify/functions/finance.mjs";
const now=Date.parse("2026-11-19T18:00:00Z");
const stamp=n=>new Date(Date.UTC(2026,9,10+n)).toISOString().slice(0,10);
test("reference series compare 20 prior moves in their native units and keep missing observations honest",()=>{
  const rows=Array.from({length:22},(_,i)=>({date:stamp(i),value:i===21?4.3:4}));
  const sofr=marketSeries("SOFR",[...rows,{date:"2030-01-01",value:8},{date:"2026-02-31",value:7}],now);
  assert.equal(sofr.points.length,22);assert.ok(Math.abs(sofr.change-30)<.00001);assert.equal(sofr.comparison.exceeded,20);assert.equal(sofr.comparison.unusual,true);
  const fx=marketSeries("EURUSD",[{date:"2026-11-18",value:2},{date:"2026-11-19",value:2.1}],now);
  assert.ok(Math.abs(fx.change-5)<1e-7);assert.equal(fx.comparison,null);assert.equal(fx.unit,"USD per EUR");
  const one=marketSeries("EURGBP",[{date:"2026-11-19",value:0.8}],now);assert.equal(one.change,null);
});
test("partial upstream availability preserves the actual chart data and scheduled auctions",async()=>{
  const ecb='<gesmes:Envelope xmlns:gesmes="x"><Cube><Cube time="2026-11-18"><Cube currency="USD" rate="1.15"/></Cube><Cube time="2026-11-19"><Cube currency="USD" rate="1.16"/></Cube></Cube></gesmes:Envelope>';
  const record={securityTerm:"13-Week",securityType:"Bill",cusip:"912797WC7",offeringAmount:"95000000000",announcementDate:"2026-11-18",competitiveAuctionCloseDate:"2026-11-23",competitiveAuctionCloseTime:"11:30 AM"};
  const fetcher=async url=>url.includes("ecb.europa")?new Response(ecb):url.includes("treasurydirect")?Response.json([record,{...record,competitiveAuctionCloseDate:"2026-10-02"}]):new Response(null,{status:503});
  const result=await loadFinance({now,fetcher});
  assert.deepEqual(result.series.map(s=>s.symbol),["EURUSD"]);assert.equal(result.series[0].asOf,"2026-11-19");
  assert.equal(result.auctions.length,1);assert.equal(result.auctions[0].id,record.cusip);assert.equal(result.sources[0].status,"unavailable");
  const response=await financeHandler(new Request("https://example.org/api/finance"),async()=>result);
  assert.equal(response.status,200);assert.deepEqual((await response.json()).auctions,result.auctions);
  assert.deepEqual(await financeEvidence("untrusted-symbol"),[]);
});
test("failed upstream retrieval reports empty observations, no synthetic figures",async()=>{
  const result=await loadFinance({now,fetcher:async()=>new Response("down",{status:429})});
  assert.deepEqual(result.series,[]);assert.deepEqual(result.auctions,[]);
  assert.equal((await financeHandler(new Request("https://example.org/api/finance"),async()=>result)).status,503);
});
