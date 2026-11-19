import {test} from "node:test";
import assert from "node:assert/strict";
import {generateSituation,readSituation} from "../server/assistant/situation.mjs";
import {briefingMaterial,validateSituation} from "../server/assistant/situation-model.mjs";
import {inputQuery,retrieve} from "../server/assistant/retrieval.mjs";

const t = Date.parse("2026-09-01T01:00:00Z");
const context = {deploy:{context:"production"},site:{id:"test"}};
const event = {id:"bulletin",title:"County announces a review hearing",summary:"The hearing concerns a proposed civic plan.",source:"County",url:"https://example.org/hearing",
  status:"confirmed",scope:"local",category:"County bulletin",location:"Maui",rank:6,updatedAt:new Date(t).toISOString(),publishedAt:new Date(t).toISOString(),
  intelligence:{level:"elevated",why:"The county has published a proposed hearing.",monitor:"Check the county's posted agenda.",reasons:["Published notice"],score:65}};
const makeSections = () => Object.fromEntries(["whatHappened","whyItMatters","whatToMonitor"].map(k =>
  [k,[{text:"The county published a hearing notice.",support:[{id:"1",quote:"announces a review hearing"}]}]]));
function harness() {
  const rows = new Map();
  let revision = 0;
  let time = t;
  let current = event;
  let calls = 0;
  let permits = 0;
  const store = {
    get:async k => rows.get(k)?.data || null,
    getWithMetadata:async k => rows.get(k) || null,
    async setJSON(k,data,opts={}) {
      const old=rows.get(k);
      if (opts.onlyIfNew && old || opts.onlyIfMatch && old?.etag !== opts.onlyIfMatch) return {modified:false};
      rows.set(k,{data,etag:String(++revision)});
      return {modified:true};
    },
  };
  const dependencies = {
    storage:() => store, clock:() => time, env:() => undefined,
    search:async () => ({events:[current],updatedAt:new Date(time).toISOString()}),
    model:() => async () => { calls++; return makeSections(); },
    permit:async ({limits}) => { assert.deepEqual(limits,{global:25,visitor:4}); permits++; return true; },
  };
  return {dependencies,counts:()=>[calls,permits],advance:()=>{time+=6*3600000;},revise:()=>{current={...current,title:"County cancels the hearing"};}};
}
const req = (query="") => new Request("https://example.org/api/situation"+query);

test("public situation reads support custom regions without contacting a model",async () => {
  const h = harness();
  const override = {...h.dependencies,model:()=>{throw Error("public GET must not call a model");}};
  const response = await readSituation(req("?location=Oahu"),context,override);
  assert.equal(response.status,200);
  const data = await response.json();
  assert.equal(data.location,"Oahu"); assert.equal(data.mode,"sources");
  assert.deepEqual(data.sections.whatHappened[0].citationIds,["1"]);
  assert.equal(data.citations[0].url,event.url);
  assert.deepEqual(h.counts(),[0,0]);
});

test("concurrent schedule invocations reserve one opportunity, validate citations and reuse unchanged material",async () => {
  const h = harness();
  const {dependencies:d}=h;
  const attempts=await Promise.all([generateSituation(context,d),generateSituation(context,d)]);
  assert.ok(attempts.some(x=>x.status==="published")); assert.deepEqual(h.counts(),[1,1]);
  const before = await (await readSituation(req(),context,d)).json();
  assert.equal(before.mode,"ai");
  assert.equal(before.citations.length,1);
  assert.deepEqual(before.sections.whatToMonitor[0].citationIds,["1"]);
  h.advance();
  assert.equal((await generateSituation(context,d)).status,"unchanged");
  const after = await (await readSituation(req(),context,d)).json();
  assert.equal(after.generatedAt,before.generatedAt);
  assert.deepEqual(h.counts(),[1,1]);
  h.revise();
  const revised = await (await readSituation(req(),context,d)).json();
  assert.equal(revised.mode,"sources"); assert.match(revised.sections.whatHappened[0].text,/cancels/);
});

test("limits, citation failure, and preview deployment do not publish invented synthesis",async () => {
  const h=harness();
  const d=h.dependencies;
  assert.equal((await generateSituation({deploy:{context:"deploy-preview"}},d)).status,"preview");
  assert.equal((await generateSituation(context,{...d,permit:async()=>false})).status,"budget");
  assert.deepEqual(h.counts(),[0,0]);
  const material=await briefingMaterial(d.search,"Maui",t);
  const unsupported=makeSections();
  unsupported.whyItMatters[0].support[0].quote="A fabricated fragment";
  assert.equal(validateSituation(unsupported,material.records),null);
  assert.equal((await (await readSituation(req(),context,d)).json()).mode,"sources");
});

test("only explicit attributed findings and matched reporting overlaps enter the analyst evidence",async () => {
  const reviewed={...event,editorialType:"investigation",byline:"Editorial desk",
    evidence:[{name:"Hearing record",url:"https://example.org/record",finding:"The signed record shows the date."}],
    counterevidence:[{name:"Minutes",url:"https://example.org/minutes",finding:"The minutes put the vote later."}]};
  const peer={...event,id:"peer",url:"https://example.org/peer",source:"Observer",editorialType:undefined,evidence:reviewed.evidence};
  const lookup=async() => ({events:[reviewed,peer],intelligence:{related:[{eventIds:["bulletin","peer"],reason:"Same named area in the same day"}]}});
  const rows=await retrieve(inputQuery({question:"What changed in these signals?",filters:{view:"signals"}}),lookup);
  assert.equal(rows.filter(r=>r.kind==="published counterevidence").length,1);
  assert.equal(rows.filter(r=>r.kind==="published evidence").length,1);
  assert.match(rows.find(r=>r.eventId==="peer").observedOverlap.limitation,/No causal link/);
  const monitor=await retrieve(inputQuery({question:"What should I monitor next?",filters:{view:"signals"}}),lookup);
  assert.equal(monitor[0].signal.monitor,event.intelligence.monitor);
});

test("routine high-rank records cannot displace a qualified signal or fill an empty local section",async () => {
  const h = harness();
  const priority = {...event,id:"national",scope:"us",rank:2,intelligence:{...event.intelligence,score:44,level:"watch"}};
  const routine = {...event,id:"opening",scope:"local",title:"Receptionist job opening",rank:1000,intelligence:null};
  const unqualified = {...routine,id:"quiet",intelligence:{score:12,level:"watch"}};
  const views = [];
  const d = {...h.dependencies,search:async options => {
    views.push(options.view);
    return {events:[routine,unqualified,priority],updatedAt:new Date(t).toISOString()};
  }};
  const brief = await (await readSituation(req(),context,d)).json();
  assert.deepEqual(views,["signals"]);
  assert.equal(brief.mode,"sources");
  assert.match(brief.notice,/No qualifying local signal for Maui/);
  assert.deepEqual(brief.citations.map(row=>row.eventId),["national"]);
  assert.equal(brief.sections.whatHappened.length,1);
});

test("new urgent evidence invalidates a cached synthesis even when its older citations are unchanged",async () => {
  const h = harness();
  const d = h.dependencies;
  assert.equal((await generateSituation(context,d)).status,"published");
  const newSignal = {...event,id:"urgent",scope:"us",title:"New regional flood warning",source:"Agency",url:"https://example.org/flood",
    intelligence:{...event.intelligence,level:"high",score:92,changeKey:"warning-issued"}};
  const updated = {...d,search:async()=>({events:[event,newSignal],updatedAt:new Date(t).toISOString()})};
  assert.equal((await generateSituation(context,updated)).status,"already-checked");
  const current = await (await readSituation(req(),context,updated)).json();
  assert.equal(current.mode,"sources");
  assert.ok(current.sections.whatHappened.some(row=>row.text.includes("flood")));
  assert.deepEqual(h.counts(),[1,1]);
});

test("a failed provider attempt cannot hide a subsequent critical signal in the same six-hour window",async () => {
  const h=harness();
  const d=h.dependencies;
  const unsupported= {...d,model:()=>async()=>({})};
  assert.equal((await generateSituation(context,unsupported)).status,"unsupported-answer");
  const elevated = {...event,id:"new-alert",title:"Seismic advisory revised",intelligence:{...event.intelligence,level:"high",score:88}};
  const successor= {...d,search:async()=>({events:[elevated],updatedAt:new Date(t).toISOString()})};
  const response=await (await readSituation(req(),context,successor)).json();
  assert.equal(response.mode,"sources");
  assert.match(response.sections.whatHappened[0].text,/Seismic advisory revised/);
  assert.deepEqual(response.citations.map(row=>row.eventId),["new-alert"]);
});
