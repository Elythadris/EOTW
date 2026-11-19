import test from "node:test";
import assert from "node:assert/strict";
import { record, combine, DAY, HOUR } from "../server/feeds/model.mjs";
import { usgs,nws,rss } from "../server/feeds/providers.mjs";
import { annotate,incidentKey,nwsKeys,observe,linkCorrection,priorWarningAreas,observeExpansion } from "../server/feeds/detection.mjs";
import { signalDesk,retainEpisodeChanges } from "../server/feeds/signal-desk.mjs";
import { addPoll,anomaliesFor } from "../server/feeds/baseline.mjs";
import { parseFeedParams, searchEvents, SNAPSHOT_KEY } from "../server/feeds/store.mjs";
import { editorialRows } from "../server/feeds/editorial.mjs";

const now=Date.parse("2026-06-15T12:00:00Z");
const iso=value=>new Date(value).toISOString();
const sample=(extra={})=>record({title:"Test report",source:"Test publisher",url:"https://www.reuters.com/test",publishedAt:now-HOUR,status:"developing",location:"Maui County",scope:"us",...extra},now);
const cap=(extra={})=>sample({source:"National Weather Service",url:"https://api.weather.gov/alerts/test",title:"Flash Flood Warning issued by NWS Honolulu",
  summary:"Official alert",severity:"high",status:"confirmed",category:"Weather",expiresAt:now+HOUR,
  origin:{event:"Flash Flood Warning",severity:"Severe",urgency:"Immediate",certainty:"Likely",episode:"nws:2026.PHFO.FF.W.001"},...extra});
const quake=(m,extra={})=>sample({source:"USGS",url:"https://earthquake.usgs.gov/earthquakes/eventpage/test",category:"Earthquake",title:"M "+m+" earthquake",
  severity:m>=6?"high":"routine",status:"confirmed",origin:{magnitude:m,pager:"green"},...extra});
const ok=id=>({id,status:"ok",lastSuccess:iso(now),intervalMinutes:5});
const desk=(rows,state={})=>signalDesk(rows,{lastSignalScan:iso(now),...state},["usgs","nws-hi","maui","maui-mema","nws-us","eonet","voices"].map(ok),now,"Maui");
test("signal gates retain documented civilian effects while rejecting routine, stale and speculative reports",()=>{
  for(const title of ["County meeting scheduled","The risk of a bank failure","Could a cyberattack disrupt hospitals?","Drill: mandatory evacuation order","Routine maintenance notice","Unsafe Water Advisory rescinded for Kula","Road closed for scheduled resurfacing","Anniversary of the 1990s conflict"]) assert.equal(annotate(sample({title}),now),null);
  for(const [title,category] of [["Ransomware attack disrupts hospital operations","Cyber disruption"],["Government imposes capital controls","Economic disruption"],["Ceasefire collapses in Moldova","Conflict and civilians"],["City orders mandatory evacuation","Civil emergency"],["Unsafe Water Advisory issued for Kula supply zone","Water safety"],["County road closed due to landslide","Transport disruption"],["Curfew imposed following protests","Civil unrest"],["Fighting displaces thousands in Moldova","Conflict and civilians"],["Countries sign peace accord","Diplomatic change"]]) {
    const result=annotate(sample({title}),now);assert.equal(result.category,category);assert.ok(result.score>=40);assert.ok(result.monitor);
  }
  assert.equal(annotate(sample({title:"Government imposes capital controls",url:"https://unknown.example/news"}),now),null);
  assert.equal(annotate(sample({title:"Government imposes capital controls",status:"speculation"}),now),null);
  assert.equal(annotate(sample({title:"Government imposes capital controls",publishedAt:now-DAY*4}),now),null);
  assert.equal(annotate(quake(3.1),now),null);
  assert.equal(annotate(cap({expiresAt:iso(now-HOUR)}),now),null);
  const expected=cap({origin:{event:"High Wind Warning",severity:"Severe",urgency:"Expected",certainty:"Likely"}});
  assert.notEqual(annotate(expected,now).level,"high");
  assert.equal(annotate(cap(),now).level,"high");
  assert.equal(annotate(cap({origin:{event:"Wind Advisory",severity:"Moderate",urgency:"Immediate",certainty:"Likely"}}),now),null);
});
test("weather records preserve upstream geometry, distinct zones, and episode identity",()=>{
  const common={status:"Actual",event:"Winter Storm Warning",sent:iso(now-HOUR),parameters:{VTEC:["/O.CON.KVEF.WS.W.0005.000000T0000Z-260616T1200Z/"]},certainty:"Likely",urgency:"Expected",severity:"Severe",expires:iso(now+HOUR)};
  const data=JSON.stringify({features:["NVZ001","CAZ555"].map((zone,i)=>({id:"https://api.weather.gov/alerts/f"+i,geometry:null,properties:{...common,areaDesc:zone,geocode:{UGC:[zone]}}}))});
  const events=nws(data).map(e=>record(e,now));
  assert.equal(incidentKey(events[0]),incidentKey(events[1]));
  assert.notEqual(events[0].origin.series,events[1].origin.series);
  assert.deepEqual(nwsKeys({sent:iso(now)}),{});
  assert.notEqual(events[0].id,events[1].id);
  const result=desk(events);
  assert.equal(result.intelligence.alerts,1);
  assert.equal(result.intelligence.activeWarnings,1);
  assert.equal(result.events[0].bulletins.length,2);
  assert.equal(result.intelligence.hotIds.length,0);
});
test("updates require comparable scans and a material source change; minor edits keep the notification key",()=>{
  const first=quake(5.8);const old=observe(null,first,first,now-HOUR,true);
  const rising=quake(6.4,{updatedAt:now-1000});
  const valid=observe(old,combine(old,rising,iso(now)),rising,now,true);
  const afterGap=observe(old,combine(old,rising,iso(now)),rising,now,false);
  assert.equal(valid.observations.changes[0].kind,"escalation");
  assert.equal(afterGap.observations.changes.length,0);
  const state={events:[valid]};retainEpisodeChanges(state,now);
  const actual=desk([valid],state);
  assert.equal(actual.intelligence.escalations[0].eventId,valid.id);
  assert.deepEqual(actual.intelligence.hotIds,[valid.id]);
  const minor={...valid,summary:"Editorial spelling correction",updatedAt:iso(now)};
  const updated=observe(valid,combine(valid,minor,iso(now)),minor,now+300000,true);
  assert.equal(annotate(updated,now+300000,"Maui").changeKey,annotate(valid,now,"Maui").changeKey);
});
test("the Hot 24 coverage test needs measured growth; reporting domains and same-scan aliases do not imply confirmation",()=>{
  const initial=sample({title:"City issues a mandatory evacuation order for all residents in the affected district"});
  const old=observe(null,initial,initial,now-HOUR,true);
  const alias=sample({title:initial.title,url:"https://apnews.com/test",publishedAt:now-300000});
  const one=observe(old,combine(old,alias,iso(now)),alias,now,true);
  assert.equal(annotate(one,now,"Maui").axes.acceleration,0);
  const two={...one,observations:{...one.observations,changes:[...one.observations.changes,{kind:"coverage",at:iso(now-60000),description:"Another publisher",version:"outlet:bbc.com"}]}};
  assert.equal(annotate(two,now,"Maui").axes.acceleration,7);
  assert.ok(desk([two]).hotEvents.length===1);
});
test("current quiet coverage differs from a source outage; co-occurrences disclose uncertainty",()=>{
  const fresh=desk([]);
  assert.equal(fresh.intelligence.regions[0].level,"quiet");
  assert.equal(signalDesk([],{lastSignalScan:iso(now)},["maui","hiema","voices"].map(ok),now,"Maui").intelligence.regions[0].level,"unknown");
  assert.ok(signalDesk([],{},[],now,"Maui").intelligence.regions.every(r=>r.level==="unknown"));
  const a=sample({title:"Mandatory evacuation ordered",url:"https://apnews.com/a",location:"Moldova",scope:"global"});
  const b=sample({title:"Evacuation orders issued in Moldova",url:"https://www.reuters.com/b",location:"Moldova",scope:"global"});
  const c=sample({title:"Evacuation orders issued elsewhere",url:"https://bbc.com/c",location:"France",scope:"global"});
  const result=desk([a,b,c]);assert.equal(result.intelligence.related.length,1);
  assert.equal(result.intelligence.related[0].eventIds.length,2);assert.match(result.intelligence.related[0].reason,/do not establish/);
  assert.equal(parseFeedParams(new URL("https://example.com/api/feed?view=signals&scope=local")).view,"signals");
});
test("baseline excludes replay and outages, compares complete matching UTC hours and requires seven complete prior days",()=>{
  const state={}, row=quake(5.2,{publishedAt:now-120000});
  addPoll(state,"usgs",now,[row],false);
  addPoll(state,"usgs",now,[row,row],true);
  addPoll(state,"usgs",now,[row],true);
  assert.equal(state.baselineDays["2026-06-15"].usgs.counts.reduce((a,b)=>a+b,0),1);
  const days={};
  for(let d=1;d<=7;d++) days[iso(now-d*DAY).slice(0,10)]={usgs:{slots:Array(24).fill(4095),counts:Array(24).fill(0)}};
  days["2026-06-15"]={usgs:{slots:Array(24).fill(4095),counts:[7,...Array(23).fill(0)],samples:[{id:row.id,hour:0}]}};
  assert.equal(anomaliesFor({baselineDays:days},now,[ok("usgs")]).anomalies.length,1);
  assert.equal(anomaliesFor({baselineDays:days},now,[]).anomalies.length,0);
  days["2026-06-10"].usgs.slots[19]=0;
  assert.equal(anomaliesFor({baselineDays:days},now,[ok("usgs")]).anomalies.length,0);
});
test("only editor-supplied cited findings acquire an evidence label",()=>{
  const source={name:"Witness document",url:"https://example.org/doc"};
  const item={type:"investigation",slug:"2026-06-14-example",title:"A researched hypothesis",byline:"Test editor",summary:"A test record.",
    publishedAt:"2026-06-14T08:00:00Z",updatedAt:"2026-06-14T09:00:00Z",sources:[source],evidence:[{...source,finding:"The document records a public meeting."}]};
  const e=record(editorialRows(JSON.stringify([item]),now)[0],now);assert.equal(e.evidence[0].url,source.url);
  assert.throws(()=>editorialRows(JSON.stringify([{...item,counterevidence:[{...source,url:"https://example.org/other",finding:"Visibility was limited."}]}]),now),/listed source/);
});

test("credible accelerating narrative coverage stays out of threat counts",()=>{
  let source=sample({topicClaim:true,title:"A review of an unusual public claim",url:"https://www.factcheck.org/claim",status:"developing"});
  source=observe(null,source,source,now-HOUR,true);
  const correction=sample({editorialType:"correction",topicClaim:true,title:"Correction to the indexed claim",url:"https://github.com/Elythadris/EOTW/blob/main/editorial/reports/fixture.md",
    supersedes:{name:source.source,url:source.url},sources:[{name:source.source,url:source.url}],publishedAt:now-60000});
  const correctionEvent=observe(null,correction,correction,now,true);
  const joined=linkCorrection(correctionEvent,source,now,true);
  const result=desk([source,joined]);
  assert.equal(result.intelligence.alerts,0);
  assert.equal(result.hotEvents.length,1);
  assert.equal(result.hotEvents[0].narrativeTrend,true);
  assert.equal(result.hotEvents[0].intelligence,undefined);
  assert.equal(linkCorrection(correctionEvent,source,now,false).observations.changes.length,0);
  assert.equal(desk([{...joined,source:"Reddit",transient:true}]).hotEvents.length,0);
});

test("the source date is preserved for Geneva bulletins, and GDACS alert levels are independent of USGS",()=>{
  const xml="<rss><channel><title>Press Items</title><item><title>Meeting</title><link>https://www.ungeneva.org/notice</link><pubDate>Wed, 18 Nov 2026 18:49:09 CET</pubDate></item></channel></rss>";
  assert.equal(new Date(rss(xml,{name:"UN"})[0].publishedAt).toISOString(),"2026-11-18T17:49:09.000Z");
  const e=sample({source:"Global Disaster Awareness and Coordination System, GDACS",title:"Tropical cyclone",url:"https://www.gdacs.org/report",gdacs:{type:"TC",level:"red",eventId:"1",episodeId:"2",freshUntil:iso(now+HOUR)}});
  assert.equal(annotate(e,now,"Maui").category,"Global disaster alerts");
  assert.equal(annotate({...e,gdacs:{...e.gdacs,type:"EQ"}},now,"Maui"),null);
  assert.equal(annotate({...e,gdacs:{...e.gdacs,freshUntil:iso(now-1)}},now,"Maui"),null);
});
test("an individual active NWS notice exposes each currently affected zone as a distinct archived link",async()=>{
  const a=cap(), b=cap({url:"https://api.weather.gov/alerts/other-zone",location:"Another county"});
  const state={version:1,events:[a,b],days:[],updatedAt:iso(now),providers:{agency:{ids:[a.id,b.id],status:"ok",lastSuccess:iso(now)}}};
  const store={get:async key=>key===SNAPSHOT_KEY?state:null};
  const result=await searchEvents({id:b.id},{store,now,defs:[{id:"agency",name:"Test agency",minutes:5}]});
  assert.equal(result.events[0].id,b.id);
  assert.equal(result.events[0].bulletinCount,2);
  assert.deepEqual(new Set(result.events[0].bulletins.map(x=>x.id)),new Set([a.id,b.id]));
});

test("NWS area expansion is a new official zone in a previously observed family, across a healthy scan",()=>{
  const vtec=(action,zone,at)=>nwsKeys({sent:iso(at),geocode:{UGC:[zone]},parameters:{VTEC:["/O."+action+".PHFO.FF.W.0001.260615T0900Z-260615T1400Z/"]}});
  const old=cap({origin:{...vtec("NEW","HIZ001",now-HOUR),event:"Flash Flood Warning",severity:"Severe",urgency:"Immediate"},updatedAt:iso(now-HOUR)});
  const previous=observe(null,old,old,now-HOUR,true);
  const known=priorWarningAreas([previous],now);
  function next(action,zone,at=now-MIN) {
    const e=cap({origin:{...vtec(action,zone,at),event:"Flash Flood Warning",severity:"Severe",urgency:"Immediate"},updatedAt:iso(at)});
    return observe(null,e,e,now,true);
  }
  const MIN=60000;
  const area=next("EXA","HIZ002");
  const expand=e=>observeExpansion(e,known,iso(now-5*MIN),now,true);
  const result=expand(area);
  assert.equal(result.observations.changes[0].kind,"escalation");
  assert.match(result.observations.changes[0].description,/explicitly expanded/);
  assert.equal(expand(result).observations.changes.length,1);
  assert.equal(expand(next("EXB","HIZ003")).observations.changes[0].version,result.observations.changes[0].version);
  for(const [act,zone] of [["EXT","HIZ002"],["CON","HIZ002"],["EXA","HIZ001"]]) assert.equal(expand(next(act,zone)).observations.changes.length,0);
  assert.equal(observeExpansion(area,new Map(),iso(now-5*MIN),now,true).observations.changes.length,0);
  assert.equal(observeExpansion(area,known,iso(now-5*MIN),now,false).observations.changes.length,0);
  assert.equal(expand(next("EXA","HIZ002",now-30*MIN)).observations.changes.length,0);
});
