import { DAY, fold, ranked } from "./model.mjs";
import { annotate, incidentKey } from "./detection.mjs";
import { anomaliesFor } from "./baseline.mjs";

const warningFor = e => /\bwarning\b/i.test(e.origin?.event || e.title);
const levels={watch:1,elevated:2,high:3};
const fresh = (at,now,age) => { const time=Date.parse(at);return Number.isFinite(time) && time<=now && now-time<=age; };
function relatedReports(signals) {
  const groups=new Map(), result=[];
  for (const event of signals) {
    const location=fold(event.location).trim();
    if (location.length<3 || location.length>90 || /(?:united states|worldwide|global|unknown)/i.test(location) ||
      /jurisdiction/i.test(event.mapNote || "") || event.source==="National Weather Service") continue;
    const key=event.intelligence.topic+"|"+location;
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(event);
  }
  for (const group of groups.values()) {
    const sorted=group.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    const first=sorted[0];
    const domain=e=>{try{return new URL(e.url).hostname.replace(/^www\./,"");}catch{return "";}};
    const found=sorted.slice(1).find(e=>domain(e)!==domain(first) && incidentKey(e)!==incidentKey(first) && Math.abs(Date.parse(e.updatedAt)-Date.parse(first.updatedAt))<=12*3600000);
    if (found) result.push({eventIds:[first.id,found.id],reason:"Both publishers report "+first.intelligence.category.toLowerCase()+" and name "+first.location+" within 12 hours. Shared timing and geography alone do not establish a connection."});
  }
  return result.slice(0,12);
}
function region(scope,events,health,lastScan,now,location) {
  const affected=events.filter(e=>e.scope===scope);
  const isMaui=fold(location).startsWith("maui");
  const serviceOK=id=>health.some(h=>h.id===id && h.status==="ok");
  const adequate=scope==="local" ? isMaui && serviceOK("nws-hi") && serviceOK("maui-mema")
    : scope==="us" ? serviceOK("nws-us") && serviceOK("usgs") && ["justice","federal","conversation"].some(serviceOK)
    : serviceOK("usgs") && serviceOK("eonet") && ["voices","gdelt","guardian"].some(serviceOK);
  const freshScan=fresh(lastScan,now,20*60000);
  const references=affected.slice(0,4).map(e=>e.id);
  if (!freshScan) return {scope,count:affected.length,level:"unknown",eventIds:references,reason:"No successful collection in the last 20 minutes."};
  if (!affected.length) {
    return {scope,count:0,level:adequate?"quiet":"unknown",eventIds:[],
      reason:adequate?"No current record from the monitored sources meets the significance rules.":"Coverage is too limited to assess this area."};
  }
  const top=affected[0];
  const partial=!adequate ? " Regional coverage is limited." : "";
  return {scope,count:affected.length,level:top.intelligence.level,eventIds:references,reason:"Highest individual signal: "+top.intelligence.category+". "+affected.length+" distinct monitored incident"+(affected.length===1?"":"s")+" in this scope. Region labels describe the strongest specific report."+partial};
}
export function collapseBulletins(events) {
  const groups=new Map();
  for (const e of events) {
    const key=incidentKey(e);
    const group=groups.get(key) || [];
    group.push(e);
    groups.set(key,group);
  }
  return [...groups.values()].map(rows=>{
    const e=rows[0];
    if (rows.length===1) return e;
    const entries=rows.map(x=>({id:x.id,location:x.location,url:x.url})).slice(0,50);
    const newest=rows.flatMap(x=>x.observations?.changes || []).filter(c=>c.kind==="escalation").sort((a,b)=>b.at.localeCompare(a.at))[0];
    const info=e.intelligence && newest ? {...e.intelligence,changeKey:e.intelligence.incidentKey+"|"+newest.version}:e.intelligence;
    return {...e,...(info?{intelligence:info}:{}),bulletinCount:rows.length,bulletins:entries};
  });
}
export function retainEpisodeChanges(state,now) {
  const episodes=state.signalEpisodes ||= {};
  for(const [id,value] of Object.entries(episodes)) if(now-Date.parse(value.at)>7*DAY) delete episodes[id];
  for(const e of state.events) {
    const newest=e.observations?.changes?.filter(c=>c.kind==="escalation" && fresh(c.at,now,7*DAY)).at(-1);
    const key=incidentKey(e);
    if(newest && (!episodes[key] || newest.at>episodes[key].at || newest.at===episodes[key].at && newest.version>episodes[key].version)) episodes[key]=newest;
  }
}
export function signalDesk(live,state,health,now,location) {
  const candidates=live.filter(e=>!e.transient && (!e.expiresAt || Date.parse(e.expiresAt)>now));
  const known=new Set(),recentlyChecked=new Set();
  for(const source of health) {
    const members=state.providers?.[source.id]?.ids || [];
    const freshSource=fresh(source.lastSuccess,now,Math.max(20,source.intervalMinutes*3)*60000);
    for(const id of members) {known.add(id);if(freshSource) recentlyChecked.add(id);}
  }
  const scored=candidates.filter(e=>!known.has(e.id) || recentlyChecked.has(e.id)).map(e=>{
    const intelligence=annotate(e,now,location);
    return intelligence ? {...ranked(e,now,location),intelligence} : null;
  }).filter(Boolean);
  // A matching local zone comes first within a split bulletin family.
  scored.sort((a,b)=>Number(b.scope==="local")-Number(a.scope==="local") || levels[b.intelligence.level]-levels[a.intelligence.level] ||
    b.intelligence.score-a.intelligence.score || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const events=collapseBulletins(scored);
  for(const e of events) {
    const prior=state.signalEpisodes?.[incidentKey(e)];
    if(prior) e.intelligence={...e.intelligence,changeKey:incidentKey(e)+"|"+prior.version};
  }
  const memberSet=new Set(events.map(e=>incidentKey(e)));
  const latestByIncident=new Map();
  for (const e of scored) {
    for (const c of e.observations?.changes || []) {
      if(c.kind!=="escalation" || !fresh(c.at,now,DAY)) continue;
      const key=incidentKey(e),prior=latestByIncident.get(key);
      if(!prior || c.at>prior.at) latestByIncident.set(key,{eventId:e.id,at:c.at,description:c.description});
    }
  }
  for(const e of events) {
    const prior=state.signalEpisodes?.[incidentKey(e)];
    if (prior && fresh(prior.at,now,DAY)) latestByIncident.set(incidentKey(e),{eventId:e.id,at:prior.at,description:prior.description});
  }
  const hotGroups=new Set(scored.filter(e=>e.intelligence.axes.acceleration>0 && (fresh(e.updatedAt,now,DAY) || e.observations?.changes?.some(c=>fresh(c.at,now,DAY)))).map(incidentKey));
  const hotEvents=events.filter(e=>hotGroups.has(incidentKey(e)) || latestByIncident.has(incidentKey(e))).sort((a,b)=>b.intelligence.axes.acceleration-a.intelligence.axes.acceleration || b.intelligence.score-a.intelligence.score);
  const lastScan=state.lastSignalScan || state.updatedAt || null;
  const scopeOrder={local:0,us:1,global:2};
  events.sort((a,b)=>scopeOrder[a.scope]-scopeOrder[b.scope] || levels[b.intelligence.level]-levels[a.intelligence.level] || b.intelligence.score-a.intelligence.score || b.updatedAt.localeCompare(a.updatedAt));
  const canonical=new Map(events.map(e=>[incidentKey(e),e.id]));
  const escalations=[...latestByIncident].filter(([id])=>memberSet.has(id)).map(([id,c])=>({...c,eventId:canonical.get(id)})).sort((a,b)=>b.at.localeCompare(a.at));
  return {events,hotEvents,intelligence:{scanned:candidates.length,alerts:events.length,activeWarnings:events.filter(e=>e.source==="National Weather Service" && warningFor(e)).length,lastScan,regions:["local","us","global"].map(scope=>region(scope,events,health,lastScan,now,location)),
    escalations,hotIds:hotEvents.map(e=>e.id),related:relatedReports(events),...anomaliesFor(state,now,health)}};
}
