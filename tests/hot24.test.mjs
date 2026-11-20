import test from "node:test";
import assert from "node:assert/strict";
import { DAY, HOUR, record } from "../server/feeds/model.mjs";
import { hotEdition, previousHotMembers, retiredHotMembers, readRetiredHot } from "../server/feeds/hot24.mjs";
import { signalDesk } from "../server/feeds/signal-desk.mjs";
import { searchEvents, SNAPSHOT_KEY } from "../server/feeds/store.mjs";
import { createFeedHandler } from "../netlify/functions/feed.mjs";

const now = Date.parse("2026-11-19T18:00:00Z");
const iso = time => new Date(time).toISOString();
const article = (id, extra={}) => record({
  source:"United Nations Office at Geneva", title:"Humanitarian agencies update civilian aid requirements",
  url:"https://www.ungeneva.org/articles/"+id, publishedAt:now-HOUR, category:"UN press bulletin",
  location:"Geneva", scope:"global", status:"confirmed", ...extra,
},now);
const desk = rows => signalDesk(rows, {lastSignalScan:iso(now)}, [], now, "Maui");

test("eligible first reports rank by consequences, scope, and evidence without requiring prior acceleration", () => {
  const local = article("local", {source:"County of Maui", location:"Maui County, Hawaiʻi", scope:"us",
    url:"https://www.mauicounty.gov/water-notice", title:"Unsafe Water Advisory issued for Kula supply zone",
    category:"County bulletin", publishedAt:now-6*HOUR});
  const international = article("global", {publishedAt:now-60_000});
  const narrative = article("fact", {source:"FactCheck.org", url:"https://www.factcheck.org/public-claim",
    title:"Examining a new QAnon claim", category:"Fact check", topicClaim:true, scope:"us", location:"United States"});
  const noise = article("filler", {category:"County bulletin", title:"County employee awards luncheon scheduled"});
  const events = desk([international,noise,narrative,local]).hotEvents;
  assert.equal(events.length,3);
  assert.equal(events[0].id,local.id);
  assert.equal(events[0].hotAt,local.publishedAt);
  assert.match(events[0].rankReasons.join(" "),/local area/);
  assert.deepEqual(new Set(events.map(e=>e.scope)),new Set(["local","us","global"]));
  assert.equal(events.find(e=>e.id===narrative.id).intelligence,undefined);
  assert.equal(events.find(e=>e.id===narrative.id).narrativeTrend,true);
  assert.deepEqual(desk([local,narrative,noise,international]).hotEvents.map(e=>e.id),events.map(e=>e.id));
});

test("Hot 24 uses publisher dates and material editions, never discovery, future publication, or a timestamp-only touch", () => {
  const stale = article("old",{publishedAt:now-3*DAY,updatedAt:now-HOUR});
  const minor = {...stale,timeline:[
    {at:stale.updatedAt,text:"Prior edition: "+stale.title+" — publisher's short description."},
    {at:stale.updatedAt,text:"Source revision: "+stale.title},
  ]};
  for (const e of [stale,minor,article("exact",{publishedAt:now-DAY}),article("future",{publishedAt:now+60_000}),
    article("discovery",{discovered:true}),article("expired",{expiresAt:now-1})]) {
    assert.equal(hotEdition(e,now),null);
  }
  const detailed = {...minor,summary:"Humanitarian agencies opened five emergency distribution sites in coastal districts after supply routes reopened."};
  assert.equal(hotEdition(detailed,now).time,stale.updatedAt);
  assert.match(hotEdition(detailed,now).reason,/substantively/);
  const escalation = {...stale,observations:{changes:[{kind:"escalation",at:iso(now-HOUR),description:"The source raised the impact classification."}]}};
  assert.equal(hotEdition(escalation,now).time,stale.updatedAt);
  assert.match(hotEdition(escalation,now).reason,/raised/);
  assert.equal(hotEdition({...escalation,updatedAt:iso(now-2*DAY)},now),null);
});

test("a rotating source keeps bounded archive pointers; withdrawal, disabled sources and expiry are respected", async () => {
  const old = article("old-coverage",{publishedAt:now-5*DAY,updatedAt:now-2*HOUR});
  old.observations={changes:[{kind:"coverage",at:old.updatedAt,description:"Another publisher carried the story."}]};
  const current = article("live");
  const expiredSoon = article("dated-hazard",{expiresAt:now+HOUR});
  const post = article("post",{transient:true,source:"Reddit"});
  const def={id:"press",name:"Press feed",minutes:10};
  const state={version:1,events:[old,current,expiredSoon,post],providers:{press:{ids:[old.id,current.id,expiredSoon.id,post.id],status:"ok",lastSuccess:iso(now)}},days:[]};
  const before=previousHotMembers(state,[def],now);
  const active=new Set([current.id]);
  state.hotArchive=retiredHotMembers(before,active,[def],now);
  assert.deepEqual(state.hotArchive.map(p=>p.id),[old.id]);
  state.events=[current];state.providers.press.ids=[current.id];
  const reads=[];
  const store={get:async key=>{
    if(key===SNAPSHOT_KEY)return state;
    reads.push(key);
    return key==="v1/days/"+old.id.slice(0,10)?[old]:[];
  }};
  const response=await searchEvents({view:"trending",scope:"global"},{now,store,defs:[def]});
  assert.equal(response.total,2);
  assert.equal(response.events.find(e=>e.id===old.id).hotAt,old.updatedAt);
  assert.deepEqual(reads,["v1/days/"+old.id.slice(0,10)]);
  for(const [defs,at] of [[[def],now+DAY],[[{...def,disabled:"Operator disabled"}],now]]) {
    assert.deepEqual(await readRetiredHot(state.hotArchive,new Set(),defs,at,()=>assert.fail("Should not read a bucket")),[]);
  }
});

test("public discussion can rank as a claim only while the approved source is current; social pages are uncached",async()=>{
  const seed = article("public-post",{source:"Reddit",url:"https://www.reddit.com/r/example/comments/abc",
    title:"Public QAnon discussion",topicClaim:true,status:"speculation",category:"Discussion",transient:true,
    interest:42,interestType:"public discussion comments"});
  const def={id:"reddit",name:"Approved discussion",minutes:10,transient:true};
  const state={version:1,events:[seed],providers:{reddit:{status:"ok",ids:[seed.id],lastSuccess:iso(now)}},days:[]};
  const store={get:async key=>key===SNAPSHOT_KEY?state:null};
  const query=at=>searchEvents({view:"trending",scope:"conspiracy"},{now:at,store,defs:[def]});
  const result=await query(now);
  assert.equal(result.events[0].status,"speculation");
  assert.equal(result.events[0].intelligence,undefined);
  assert.match(result.events[0].rankReasons.join(" "),/42 public discussion comments/);
  assert.equal((await query(now+HOUR)).events.length,0);
  const get=createFeedHandler(async()=>result);
  const resp=await get(new Request("https://eotw.invalid/api/feed?view=trending"));
  assert.equal(resp.headers.get("Cache-Control"),"no-store");
  assert.equal(resp.headers.get("Netlify-CDN-Cache-Control"),null);
});

test("a new archive reference to a historical narrative stays out of Hot 24", () => {
  assert.equal(hotEdition({referenceOnly:true,publishedAt:new Date().toISOString()},Date.now()),null);
});
