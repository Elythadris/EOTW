import { test } from "node:test";
import assert from "node:assert/strict";
import { assessmentResponseFormat, readAssessmentChoices } from "../server/assistant/assessment-request.mjs";
import { assessmentHandler } from "../server/assistant/assessment.mjs";
import { assessmentMaterial, applyModelSelection, modelInput, sourceAssessment } from "../server/assistant/assessment-model.mjs";

const id = "2026-08-15-abcdef0123456789abcd";
const event = {
  id, title:"Flood warning for a river basin",source:"National Weather Service",url:"https://api.weather.gov/alerts/agency-bulletin",
  publishedAt:"2026-08-15T04:00:00Z",updatedAt:"2026-08-15T05:00:00Z",status:"confirmed",category:"Weather",
  location:"Maui",scope:"local",timeline:[],summary:"Heavy rainfall has raised water levels. Additional rainfall is expected in the basin.",
  intelligence:{level:"elevated",score:67,why:"The issuing authority published a flood warning.",monitor:"Check the next official gauge reading."},
};
const ctx={deploy:{context:"production"},site:{id:"test"},ip:"127.0.0.1"};
const req=(code=id)=>new Request("https://example.org/api/assessment?id="+code);
const expectedSelection=input=>({hypotheses:input.alternatives.slice(0,2).map(o=>({id:o.id,support:o.support.map(p=>p.ref),against:o.against.map(p=>p.ref)}))});
function setup(story = event) {
  let now=Date.parse(event.updatedAt);
  let etag=0,uses=0,permits=0;
  let current=story;
  const rows=new Map();
  const store={
    getWithMetadata:async key=>rows.get(key) || null,
    setJSON:async(key,data,opts)=>{
      const old=rows.get(key);
      if ((opts.onlyIfNew && old) || (opts.onlyIfMatch && old?.etag !== opts.onlyIfMatch)) return {modified:false};
      const tag=String(++etag);
      rows.set(key,{data,etag:tag});
      return {modified:true,etag:tag};
    },
  };
  const dependencies={clock:()=>now,env:()=>undefined,storage:()=>store,search:async()=>({events:current?[current]:[]}),
    model:()=>async input=>{uses++;return expectedSelection(input);},
    permit:async({limits})=>{permits++;assert.deepEqual(limits,{global:25,visitor:5});return true;},
  };
  return {dependencies,rows,counts:()=>[uses,permits],revise:e=>{current=e;},tick:(minutes)=>{now+=minutes*60000;}};
}

test("source assessment uses distinct current-source passages for identifiable alternatives",()=>{
  const material=assessmentMaterial(event);
  const source=sourceAssessment(material);
  assert.equal(source.mode,"sources");
  assert.deepEqual(source.allegations,[]);
  const runoff=source.hypotheses.find(h=>h.label.includes("Runoff"));
  assert.match(runoff.support[0].text,/Heavy rainfall has raised/);
  assert.deepEqual(runoff.support[0].citationIds,["1"]);
  assert.deepEqual(runoff.against,[]);
  assert.deepEqual(source.implications,[]);
  assert.deepEqual(source.citations,[{id:"1",title:event.title,source:event.source,url:event.url}]);
  assert.ok(source.unknowns.length && source.watch[0].citationIds.length);
  const valid=expectedSelection(modelInput(material));
  assert.equal(applyModelSelection(valid,material).mode,"ai");
  valid.hypotheses[0].support=["unknown.4"];
  assert.equal(applyModelSelection(valid,material),null);
});

test("a crash cannot open deliberate-interference speculation without an explicit official inquiry",()=>{
  const aircraft={...event,source:"Transport board",url:"https://www.ntsb.gov/reports/record",title:"Aircraft accident investigation opens",
    category:"Aviation",summary:"Investigators ruled out engine failure after examining the aircraft."};
  const ordinary=sourceAssessment(assessmentMaterial(aircraft));
  assert.equal(ordinary.hypotheses.some(x=>x.label.includes("inquiry")),false);
  const mechanical=ordinary.hypotheses.find(x=>x.label.includes("Equipment"));
  assert.deepEqual(mechanical.support,[]);
  assert.match(mechanical.against[0].text,/ruled out engine failure/);
  const official=sourceAssessment(assessmentMaterial({...aircraft,summary:"The board is investigating possible sabotage. A final report is pending."}));
  assert.equal(official.hypotheses[0].label,"An explicitly reported inquiry");
  assert.match(official.hypotheses[0].explanation,/does not identify a cause/);
  const secondary=sourceAssessment(assessmentMaterial({...aircraft,url:"https://example.org/report",summary:"The board is investigating possible sabotage."}));
  assert.equal(secondary.hypotheses.some(x=>x.label.includes("inquiry")),false);
});

test("model selectors cannot invent citations or suppress documented contradictory findings",()=>{
  const story={...event,editorialType:"investigation",source:"Research desk",byline:"Evidence desk",url:"https://example.org/review",
    counterevidence:[{name:"Published gauge record",url:"https://example.org/gauge",finding:"The gauge record rules out heavy rainfall."}]};
  const material=assessmentMaterial(story);
  const input=modelInput(material);
  const raw=expectedSelection(input);
  raw.hypotheses[0].against=[];
  const output=applyModelSelection(raw,material);
  assert.equal(output.mode,"ai");
  assert.match(output.hypotheses[0].against[0].text,/Published gauge record|Evidence desk/);
  assert.deepEqual(output.hypotheses[0].against[0].citationIds,["2"]);
  const injected=structuredClone(raw);
  injected.hypotheses[0].id="unverified-covert-actor";
  assert.equal(applyModelSelection(injected,material),null);
});

test("public discussion stays transient and outside model calls or assessment storage",async()=>{
  const story={...event,title:"A disputed account circulates",source:"Reddit",url:"https://www.reddit.com/r/conspiracy/comments/example",
    category:"Public discussion",status:"speculation",topicClaim:true,intelligence:undefined};
  const h=setup(story);
  const response=await assessmentHandler(h.dependencies)(req(),ctx);
  assert.match(response.headers.get("cache-control"),/no-store/);
  const body=await response.json();
  assert.equal(body.mode,"sources");
  assert.ok(body.allegations[0].citationIds.length);
  assert.ok(body.hypotheses.every(x=>!x.support.length));
  assert.deepEqual(h.counts(),[0,0]);assert.equal(h.rows.size,0);
});

test("concurrent reads reserve at most one model call and changed evidence invalidates the saved selection",async()=>{
  const h=setup();
  const handle=assessmentHandler(h.dependencies);
  const first=await Promise.all([handle(req(),ctx),handle(req(),ctx)]);
  const values=await Promise.all(first.map(r=>r.json()));
  assert.ok(values.some(r=>r.mode==="ai"));assert.deepEqual(h.counts(),[1,1]);
  assert.equal((await (await handle(req(),ctx)).json()).mode,"ai");assert.deepEqual(h.counts(),[1,1]);
  assert.doesNotMatch(JSON.stringify([...h.rows.values()]),/Heavy rainfall|National Weather Service/);
  h.revise({...event,summary:"The authority revised its flood forecast after heavy rainfall."});
  assert.equal((await (await handle(req(),ctx)).json()).mode,"ai");assert.deepEqual(h.counts(),[2,2]);
});

test("preview, unavailable provider, exhausted quota, bad model output and blob failures leave readable source assessments",async()=>{
  const h=setup();
  const preview=await assessmentHandler(h.dependencies)(req(),{deploy:{context:"deploy-preview"}});
  assert.equal((await preview.json()).mode,"sources");assert.deepEqual(h.counts(),[0,0]);
  for (const overrides of [{model:()=>null},{permit:async()=>false},{model:()=>async()=>({hypotheses:[{id:"invented"}]})},
    {storage:()=>{throw Error("storage unavailable");}}]) {
    const response=await assessmentHandler({...h.dependencies,...overrides})(req(),ctx);
    const body=await response.json();
    assert.equal(response.status,200);assert.equal(body.mode,"sources");assert.ok(body.facts.length && body.hypotheses.length);
  }
  assert.equal((await assessmentHandler(h.dependencies)(req("bad"),ctx)).status,400);
  assert.equal((await assessmentHandler(h.dependencies)(new Request(req().url,{method:"POST"}),ctx)).status,405);
  const head=await assessmentHandler(h.dependencies)(new Request(req().url,{method:"HEAD"}),ctx);
  assert.equal(head.status,200);assert.equal(await head.text(),"");
  h.revise(null);assert.equal((await assessmentHandler(h.dependencies)(req(),ctx)).status,404);
});

test("mixed developing news separates allegations from documented reporting and verified readings retain decimals",()=>{
  const story={...event,status:"developing",category:"Weather",title:"Agency opens gauge review",
    summary:"The river gauge measured 5.3 feet. Residents alleged heavy rainfall caused the failure."};
  const m=assessmentMaterial(story);
  const result=sourceAssessment(m);
  assert.match(result.facts.map(p=>p.text).join(" "),/5\.3 feet/);
  assert.doesNotMatch(result.facts.map(p=>p.text).join(" "),/alleged/);
  assert.match(result.allegations[0].text,/Residents alleged/);
  assert.equal(result.hypotheses.some(h=>h.support.some(p=>/alleged/.test(p.text))),false);
  assert.equal(m.canWrite,false);
  const title=sourceAssessment(assessmentMaterial({...story,title:"Residents allege sabotage caused aircraft crash",category:"Aviation"}));
  assert.match(title.allegations[0].text,/Residents allege/);
  assert.doesNotMatch(title.facts.map(p=>p.text).join(" "),/sabotage/);
  const ordinary=sourceAssessment(assessmentMaterial({...story,summary:"The gauge measured 5.3 feet."}));
  assert.deepEqual(ordinary.allegations,[]);
});

test("editorial polarity relative to a claim does not determine its bearing on a conventional alternative",()=>{
  const story={...event,title:"UAP observation examined",source:"Evidence desk",topicClaim:true,category:"Claim coverage",editorialType:"investigation",
    summary:"A published review examines a reported observation.",url:"https://example.org/review",
    counterevidence:[
      {name:"Sensor record",url:"https://example.org/sensor",finding:"Independent calibration documented a sensor error in the recording."},
      {name:"Calibration",url:"https://example.org/calibration",finding:"The calibration ruled out sensor error."},
    ]};
  const explanation=sourceAssessment(assessmentMaterial(story)).hypotheses.find(h=>h.label==="An instrument or recording artifact");
  assert.ok(explanation.support.some(p=>p.text.includes("documented a sensor error")));
  assert.ok(explanation.against.some(p=>p.text.includes("ruled out sensor error")));
  assert.ok(explanation.against.every(p=>!p.text.includes("documented a sensor error")));
  const crash=sourceAssessment(assessmentMaterial({...event,category:"News",title:"Plane crashes during approach",summary:"An investigation is under way."}));
  assert.ok(crash.hypotheses.some(h=>h.label==="Equipment or maintenance"));
});

test("model-authored conventional inference is conditional, source-bound and independently validated",()=>{
  const material=assessmentMaterial(event);
  const raw=expectedSelection(modelInput(material));
  const valid="If heavy rainfall continues, water levels could keep rising after local rain eases.";
  raw.hypotheses[0].inference=valid;
  const first=applyModelSelection(raw,material).hypotheses[0];
  assert.equal(first.origin,"model");assert.equal(first.explanation,valid);assert.deepEqual(first.inferenceCitationIds,["1"]);
  for (const bad of [
    "If rainfall continues, a named actor could sabotage public infrastructure.",
    "If heavy rainfall continues, water levels could rise by two metres.",
    "If a region grows, an unmapped road could be blocked.",
    "A specific person must have caused the incident.",
    "If heavy rainfall continues, Baker could change the water levels.",
  ]) {
    raw.hypotheses[0].inference=bad;
    assert.equal(applyModelSelection(raw,material).hypotheses[0].origin,"research");
  }
  raw.hypotheses[0].inference=valid;
  const sensitive=assessmentMaterial({...event,title:"Flood warning near a military facility"});
  assert.equal(applyModelSelection(raw,sensitive).hypotheses[0].origin,"research");
  raw.hypotheses[0].support=[];
  assert.equal(applyModelSelection(raw,material).hypotheses[0].origin,"research");
});

test("forecast text supports the forecast alternative without becoming evidence of recorded runoff",()=>{
  const report={...event,summary:"Heavy rainfall is expected to redevelop. Expected rainfall will raise river levels on the Little Wekiva River."};
  const material=assessmentMaterial(report);
  const input=modelInput(material);
  const runoff=input.alternatives.find(o=>o.id==="water-runoff");
  const forecast=input.alternatives.find(o=>o.id==="water-forecast");
  assert.equal(runoff.support.length,0);assert.equal(forecast.support.length,2);
  const selection=expectedSelection(input);
  selection.hypotheses.find(h=>h.id==="water-forecast").inference="If heavy rainfall redevelops, river levels could rise further.";
  assert.equal(applyModelSelection(selection,material).hypotheses.find(h=>h.label==="Additional forecast rainfall").origin,"model");
});
test("the provider schema binds each real candidate to its own available passage refs",()=>{
  const material=assessmentMaterial(event);
  const input=modelInput(material);
  const fields=assessmentResponseFormat(input.alternatives).json_schema.schema.properties.comparisons;
  assert.deepEqual(fields.required,input.alternatives.map(o=>o.id));
  for (const opt of input.alternatives) {
    const schema=fields.properties[opt.id].properties;
    assert.equal(schema.against.maxItems,0);
    assert.deepEqual(schema.support.items.enum,opt.support.map(p=>p.ref));
  }
  const selected=input.alternatives[0];
  const raw={comparisons:{[selected.id]:{selected:true,support:[selected.support[0].ref],against:[],inference:""}}};
  const output=applyModelSelection(readAssessmentChoices(raw,input.alternatives),material);
  assert.equal(output.mode,"ai");
  assert.equal(output.hypotheses.length,2);
  assert.ok(output.hypotheses.some(h=>h.support.length));
  raw.comparisons[selected.id].support=["9.99"];
  let invalid;
  assert.equal(applyModelSelection(readAssessmentChoices(raw,input.alternatives),material,r=>{invalid=r;}),null);
  assert.equal(invalid,"support-reference");
});
test("cached cooldowns retain a safe validation reason or provider status and give the reader the corresponding notice",async()=>{
  for (const [kind,model,expected,notice] of [
    ["selection",()=>async()=>({hypotheses:[{id:"private story text from upstream"}]}),{kind:"selection",reason:"candidate-id"},/supported by these source passages/],
    ["provider",()=>async()=>{const error=new Error("private upstream account text");error.status=429;throw error;},{kind:"provider",category:"provider-http",httpStatus:429},/provider could not complete/],
  ]) {
    const h=setup();
    const handler=assessmentHandler({...h.dependencies,model});
    for (let i=0;i<2;i++) {
      const body=await (await handler(req(),ctx)).json();
      assert.equal(body.mode,"sources");
      assert.match(body.notice,notice);
    }
    const saved=[...h.rows.values()][0].data;
    assert.equal(saved.state,"cooldown");
    assert.deepEqual(saved.diagnostic,expected);
    assert.doesNotMatch(JSON.stringify(saved.diagnostic),/private/);
    assert.ok(kind);
  }
});

test("NWS observed runoff and a separate forward rainfall forecast keep their respective source passages",()=>{
  const report={...event,summary:"Extreme rainfall over the headwaters of the St. Johns River has caused the river near Cocoa to rise through Major Flood Stage. Additional heavy rainfall over the next 48 hours will continue to produce river rises above record flood levels."};
  const assessment=sourceAssessment(assessmentMaterial(report));
  const past=assessment.hypotheses.find(h=>h.label==="Runoff from recent rainfall");
  const future=assessment.hypotheses.find(h=>h.label==="Additional forecast rainfall");
  assert.equal(past.support.length,1);assert.match(past.support[0].text,/St\. Johns River has caused/);
  assert.equal(future.support.length,1);assert.match(future.support[0].text,/Additional heavy rainfall over the next 48 hours/);
  assert.deepEqual(past.support[0].citationIds,["1"]);assert.deepEqual(future.support[0].citationIds,["1"]);
  const historical=sourceAssessment(assessmentMaterial({...report,summary:"Additional heavy rainfall raised the river over the previous week."}));
  assert.equal(historical.hypotheses.find(h=>h.label==="Additional forecast rainfall").support.length,0);
});
