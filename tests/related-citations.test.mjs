import assert from "node:assert/strict";
import test from "node:test";
import { HOUR, record } from "../server/feeds/model.mjs";
import { signalDesk } from "../server/feeds/signal-desk.mjs";

const now=Date.parse("2026-11-19T18:00:00Z");
const iso=t=>new Date(t).toISOString();
const weatherUrl="https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.99.111.001.1";
const nws=(url=weatherUrl,area="Maui")=>record({
  source:"National Weather Service",url,title:"Flash Flood Warning for "+area,location:area,
  publishedAt:now-HOUR,expiresAt:now+HOUR,scope:"us",category:"Weather",status:"confirmed",
  severity:"high",origin:{episode:"nws:2026.PHFO.FF.W.001",event:"Flash Flood Warning",severity:"Severe",urgency:"Immediate",certainty:"Likely"},
},now);
const county=(more={})=>record({
  source:"County of Maui",url:"https://www.mauicounty.gov/CivicAlerts.aspx?AID=9087",title:"Unsafe water advisory issued for Kula",
  publishedAt:now-30*60000,location:"Kula",category:"County bulletin",scope:"us",status:"confirmed",...more,
},now);
const desk=events=>signalDesk(events,{lastSignalScan:iso(now)},[],now,"Maui").intelligence.related;
test("explicit cross-category publisher citations resolve tracking parameters and grouped warning zones to one relationship",()=>{
  const maui=nws(),other=nws(weatherUrl+"2","Other zone");
  const advisory=county({sources:[{name:"NWS",url:other.url+"?utm_campaign=agency#notice"}]});
  const links=desk([advisory,maui,other]);
  assert.equal(links.length,1);
  assert.deepEqual(links[0].eventIds,[advisory.id,maui.id]);
  assert.match(links[0].reason,/County of Maui directly references the specific report from National Weather Service/);
  assert.match(links[0].reason,/cause requires separate evidence/);
});
test("source indices, mirrored coverage, ambiguous URLs and citations inside one episode do not imply a cross-event relationship",()=>{
  for(const url of ["https://www.weather.gov/","https://www.weather.gov/press-releases","https://www.weather.gov/alerts/active?area=HI","https://www.weather.gov/feed.xml"]) {
    assert.deepEqual(desk([nws(url),county({sources:[{name:"NWS",url}]})]),[]);
  }
  const a=nws(),b=county({sources:[{name:"Weather desk",url:a.url}]});
  b.observations={publishers:["mauicounty.gov","api.weather.gov"],changes:[]};
  assert.deepEqual(desk([a,b]),[]);
  const duplicate={...a,id:"other-record",origin:{...a.origin,episode:"another-episode"}};
  assert.deepEqual(desk([a,duplicate,county({summary:"Read "+a.url+" for updates."})]),[]);
  const next=nws(weatherUrl+"2","Other zone");
  next.origin.references=[a.url];
  assert.deepEqual(desk([a,next]),[]);
});
test("a direct link preempts co-occurrence for the same pair; ordinary nearby reports never gain causal attribution",()=>{
  const a=county({title:"County declares a public health emergency",location:"Kula"});
  const b=county({title:"Emergency declared for Kula hospitals",source:"Reuters",url:"https://www.reuters.com/world/public-health-emergency-kula",location:"Kula"});
  const linked=desk([a,{...b,summary:"County source: "+a.url+"."}]);
  assert.equal(linked.length,1);
  assert.match(linked[0].reason,/directly references/);
  const geographic=desk([a,b]);
  assert.equal(geographic.length,1);
  assert.match(geographic[0].reason,/Shared timing and geography/);
});
