import { DAY, fold, ranked, link } from "./model.mjs";
import { annotate, incidentKey } from "./detection.mjs";
import { buildHot24 } from "./hot24.mjs";
import { anomaliesFor } from "./baseline.mjs";

const warningFor = e => /\bwarning\b/i.test(e.origin?.event || e.title);
const levels={watch:1,elevated:2,high:3};
const fresh = (at,now,age) => { const time=Date.parse(at);return Number.isFinite(time) && time<=now && now-time<=age; };
// Canonicalise only identifiable documents. A shared newsroom, alert index or feed
// cannot identify which report a publisher was citing.
function documentKey(value) {
  const clean = link(value);
  if (!clean) return "";
  const url = new URL(clean);
  const hostname = url.hostname.replace(/^www\./,"");
  if (!hostname.includes(".") || url.port || /^\d+(\.\d+){3}$/.test(hostname)) return "";
  const path = url.pathname.replace(/\/+$/, "");
  const leaf = path.slice(path.lastIndexOf("/") + 1);
  const identity = [...url.searchParams].some(([key,v]) =>
    /^(?:aid|id|articleid|eventid|docid|documentid|reportid|storyid|guid)$/i.test(key) && /^[\w.:-]{1,150}$/.test(v));
  if (!identity) {
    if (!leaf || /^(?:index|home|news|newsroom|press|(?:press|news|media)[-_](?:room|centre|center|releases?|statements?)|(?:all|active|public)[-_](?:notices?|alerts?|records?)|releases?|stories|docs?|documents?|announcements?|archive|alerts?|active|events?|notices?|updates?|reports?|search|feeds?|rss|atom|categories|media|publications?|latest)(?:\.[a-z0-9]+)?$/i.test(leaf)) return "";
    if (/\.(?:rss|atom)$/i.test(leaf) || /^\/(?:tags?|topics?|category|authors?)\//i.test(path)) return "";
    if (!/\d.*[a-z]|[a-z].*\d|[a-z]{2,}[-_][a-z0-9]{2,}|\.(pdf|html?)$/i.test(leaf) && !/^\d{5,}$/.test(leaf)) return "";
  }
  url.searchParams.sort();
  return hostname + path + url.search;
}
function publisherHost(value) {
  try { return new URL(value).hostname.replace(/^www\./,""); } catch { return ""; }
}
function reportReferences(event) {
  const references = [
    ...(event.origin?.references || []),
    ...(event.evidence || []).map(item => item.url),
    ...(event.counterevidence || []).map(item => item.url),
    event.supersedes?.url,
  ];
  // Merged mirror URLs identify republishers. They are not citations from the story.
  const owner = publisherHost(event.url);
  const additionalDomains = new Set((event.observations?.publishers || []).filter(domain => domain !== owner));
  const coverage = new Set((event.timeline || []).filter(t => t.text.startsWith("Additional coverage indexed from "))
    .map(t => t.text.slice("Additional coverage indexed from ".length).replace(/\.$/, "")));
  for (const item of event.sources || []) {
    const host = publisherHost(item.url);
    if (event.editorialType || host !== owner && !additionalDomains.has(host) && !coverage.has(item.name)) references.push(item.url);
  }
  const literal = (event.summary || "").match(/https?:\/\/[^\s<>"']+/gi) || [];
  return [...new Set([...references, ...literal.map(url => url.replace(/[.,;)\]]+$/, ""))].slice(0, 48).map(documentKey).filter(Boolean))];
}
function directRelationships(signals, records, now) {
  const leaders = new Map(signals.map(e => [incidentKey(e),e]));
  const eligible = records.filter(e => !e.transient && !e.topicClaim && e.status !== "speculation" &&
    (leaders.has(incidentKey(e)) || fresh(e.updatedAt,now,7*DAY)));
  const byUrl = new Map();
  for (const e of eligible) {
    const key = documentKey(e.url);
    if (!key) continue;
    // Shared canonical URLs with conflicting incident identities are ambiguous.
    if (!byUrl.has(key)) byUrl.set(key,e);
    else if (byUrl.get(key) && incidentKey(byUrl.get(key)) !== incidentKey(e)) byUrl.set(key,null);
  }
  const found = new Map();
  for (const source of eligible) {
    for (const key of reportReferences(source)) {
      const target = byUrl.get(key);
      if (!target || incidentKey(target) === incidentKey(source) || fold(target.title) === fold(source.title)) continue;
      const sourceLead = leaders.get(incidentKey(source)), targetLead = leaders.get(incidentKey(target));
      if (!sourceLead && !targetLead) continue;
      const a = sourceLead || source, b = targetLead || target;
      const pair = [a.id,b.id].sort().join("|");
      if (found.has(pair)) continue;
      found.set(pair, {
        eventIds:[a.id,b.id],
        reason:source.source+" directly references the specific report from "+target.source+". The citation documents a reporting link. Establishing cause requires separate evidence.",
        local:Number(a.scope === "local" || b.scope === "local"),
        distinct:Number(a.category !== b.category),
        at:source.updatedAt,
      });
    }
  }
  return [...found.values()].sort((a,b) => b.local-a.local || b.distinct-a.distinct || b.at.localeCompare(a.at) || a.eventIds[0].localeCompare(b.eventIds[0]))
    .slice(0,12).map(({eventIds,reason}) => ({eventIds,reason}));
}
function relatedReports(signals,records,now) {
  const groups=new Map(), result=directRelationships(signals,records,now);
  const linked = new Set(result.map(r => [...r.eventIds].sort().join("|")));
  if (result.length >= 12) return result;
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
    const domain=e=>publisherHost(e.url);
    const found=sorted.slice(1).find(e=>domain(e)!==domain(first) && incidentKey(e)!==incidentKey(first) && Math.abs(Date.parse(e.updatedAt)-Date.parse(first.updatedAt))<=12*3600000);
    if (found && !linked.has([first.id,found.id].sort().join("|"))) result.push({eventIds:[first.id,found.id],reason:"Two publisher domains report "+first.intelligence.category.toLowerCase()+" and name "+first.location+" within 12 hours. Shared timing and geography alone do not establish a connection."});
  }
  return result.slice(0,12);
}
function region(scope,events,health,lastScan,now,location) {
  const affected=events.filter(e=>e.scope===scope);
  const isMaui=/^maui(?: county)?(?:,|$)/.test(fold(location).trim());
  const serviceOK=id=>health.some(h=>h.id===id && h.status==="ok");
  const adequate=scope==="local" ? isMaui && serviceOK("nws-hi") && serviceOK("maui-mema")
    : scope==="us" ? serviceOK("nws-us") && serviceOK("usgs") && ["justice","federal","conversation"].some(serviceOK)
    : serviceOK("usgs") && (serviceOK("eonet") || serviceOK("gdacs")) && ["voices","gdelt","guardian","un-geneva"].some(serviceOK);
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
export function signalDesk(live,state,health,now,location,retired=[]) {
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
  const hotCandidates = [...live, ...retired].filter(e =>
    e.source !== "National Weather Service" || !known.has(e.id) || recentlyChecked.has(e.id));
  const hotEvents = buildHot24(hotCandidates, scored, now, location, collapseBulletins);
  const lastScan=state.lastSignalScan || state.updatedAt || null;
  const scopeOrder={local:0,us:1,global:2};
  events.sort((a,b)=>scopeOrder[a.scope]-scopeOrder[b.scope] || levels[b.intelligence.level]-levels[a.intelligence.level] || b.intelligence.score-a.intelligence.score || b.updatedAt.localeCompare(a.updatedAt));
  const canonical=new Map(events.map(e=>[incidentKey(e),e.id]));
  const escalations=[...latestByIncident].filter(([id])=>memberSet.has(id)).map(([id,c])=>({...c,eventId:canonical.get(id)})).sort((a,b)=>b.at.localeCompare(a.at));
  return {events,hotEvents,intelligence:{scanned:candidates.length,alerts:events.length,activeWarnings:events.filter(e=>e.source==="National Weather Service" && warningFor(e)).length,lastScan,regions:["local","us","global"].map(scope=>region(scope,events,health,lastScan,now,location)),
    escalations,hotIds:hotEvents.filter(e=>!e.transient).map(e=>e.id),related:relatedReports(events,candidates.filter(e=>!known.has(e.id) || recentlyChecked.has(e.id)),now),...anomaliesFor(state,now,health)}};
}
