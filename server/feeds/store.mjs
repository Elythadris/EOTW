import { annotate, observe, incidentKey, linkCorrection, priorWarningAreas, observeExpansion } from "./detection.mjs";
import { previousHotMembers, retiredHotMembers, readRetiredHot } from "./hot24.mjs";
import { addPoll } from "./baseline.mjs";
import { collapseBulletins, signalDesk, retainEpisodeChanges } from "./signal-desk.mjs";
import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { editorialTypes } from "./editorial.mjs";
import { DAY, HOUR, ranked, fold, combine, validId } from "./model.mjs";
import { definitions, fetchProvider } from "./providers.mjs";

export const SNAPSHOT_KEY = "v1/briefing";
const dayKey = day => "v1/days/" + day;
const stamp = time => new Date(time).toISOString();
import { openSnapshot as checkSchema } from "./migrations/001-initial.mjs";
export function repository() {
  // Scheduled production data is public reporting. Netlify Dev uses its emulated store.
  return getStore({name:"eotw-reporting-v1",consistency:"strong"});
}
async function writeConditionally(store,key,data,previous) {
  return (await store.setJSON(key,data,previous ? {onlyIfMatch:previous.etag} : {onlyIfNew:true})).modified;
}
async function lease(store,now) {
  const key="v1/collector-lease";
  const old=await store.getWithMetadata(key,{type:"json"});
  if (old && old.data.until > now) return false;
  return writeConditionally(store,key,{until:now+90000},old);
}
const sourceState = (state,id) => state.providers[id] || {status:"pending",lastSuccess:null,ids:[]};
export function sourceHealth(state,defs,now) {
  return defs.map(def => {
    const entry=sourceState(state,def.id);
    const late=entry.status === "ok" && now-Date.parse(entry.lastSuccess) > Math.max(20,def.minutes*3)*60000;
    return {id:def.id,name:def.name,status:def.disabled ? "disabled" : late ? "error" : entry.status,
      lastSuccess:entry.lastSuccess,detail:def.disabled || (late ? "Scheduled check overdue." : entry.detail || ""),
      intervalMinutes:def.minutes,lastAttempt:entry.lastAttempt || null,
      nextAttemptAt:!def.disabled && Number.isFinite(entry.nextDue) ? stamp(entry.nextDue) : null};
  });
}
function fingerprint(event) {
  if (event.title.length < 48 || event.editorialType || event.transient || ["Weather","Earthquake","Natural event"].includes(event.category)) return "";
  return event.publishedAt.slice(0,10) + "|" + fold(event.title).replace(/[^\p{L}\p{N}]+/gu," ").trim();
}
async function updateDay(store,day,changes) {
  const key=dayKey(day);
  for (let attempt=0;attempt<3;attempt++) {
    const prev=await store.getWithMetadata(key,{type:"json"});
    const entries=new Map((prev?.data || []).map(e=>[e.id,e]));
    for (const entry of changes) {
      const existing=entries.get(entry.id);
      if (existing && entry.editorialType && existing.updatedAt <= entry.updatedAt) {
        entries.set(entry.id, combine(existing, entry, entry.updatedAt));
      } else if (!existing || existing.updatedAt <= entry.updatedAt) {
        const history=new Map([...(existing?.timeline || []),...entry.timeline].map(t=>[t.at+"|"+t.text,t]));
        const sources=new Map([...(existing?.sources || []),...entry.sources].map(s=>[s.url,s]));
        entries.set(entry.id,{...entry,timeline:[...history.values()],sources:[...sources.values()].slice(0,12)});
      }
    }
    if (await writeConditionally(store,key,[...entries.values()],prev)) return;
  }
  throw new Error("Concurrent archive update");
}
async function processInBatches(items,size,fn) {
  for (let index=0;index<items.length;index+=size) await Promise.all(items.slice(index,index+size).map(fn));
}
function nextSlot(now, minutes) {
  const interval = minutes * 60_000;
  return Math.floor(now / interval) * interval + interval;
}
function providerDue(def, entry, now) {
  if (def.disabled) return false;
  if (!entry) return true;
  // An existing failure may carry a provider-issued Retry-After deadline.
  if (entry.status === "error") return !(entry.nextDue > now);
  const lastAttempt = Date.parse(entry.lastAttempt || "");
  return !Number.isFinite(lastAttempt) || nextSlot(lastAttempt, def.minutes) <= now;
}
export async function collect({store=repository(),now=Date.now(),defs=definitions(),load=fetchProvider,nextScheduledAt=null}={}) {
  const started = Date.now();
  if (!(await lease(store,now))) return {busy:true};
  const previous=await store.getWithMetadata(SNAPSHOT_KEY,{type:"json"});
  const state=checkSchema(previous?.data);
  const priorHot = previousHotMembers(state, defs, now);
  // A pre-fallback snapshot has a single backoff for both feeds. Preserve the
  // original DOC deadline while allowing the independent Article List to run.
  const gdelt = state.providers.gdelt;
  if (gdelt?.status === "error" && gdelt.nextDue > now && !Object.hasOwn(gdelt, "primaryRetryAfter")) {
    gdelt.primaryRetryAfter = gdelt.nextDue;
    gdelt.nextDue = now;
  }
  const due=defs.filter(def=>providerDue(def,state.providers[def.id],now));
  const result=await Promise.allSettled(due.map(async def=>{
    const old=sourceState(state,def.id);
    const validators=(["nws-us","nws-hi","usgs","eonet"].includes(def.id) && old.signalSchema!==3) ? {...old,etag:null,modified:null} : old;
    return load(def,validators,{now});
  }));
  const previousAreas=priorWarningAreas(state.events,now);
  const pool=new Map(state.events.map(e=>[e.id,e]));
  const byUrl=new Map(), byHeadline=new Map(), bySeries=new Map();
  function index(e) {
    byUrl.set(e.url,e.id);
    if(e.origin?.series && (pool.get(bySeries.get(e.origin.series))?.updatedAt || "")<=e.updatedAt) bySeries.set(e.origin.series,e.id);
    const fp=fingerprint(e);
    if (fp) byHeadline.set(fp,e.id);
  }
  state.events.forEach(index);
  const changed=new Map();
  let successes=0;
  for (const [offset,def] of due.entries()) {
    const attempt=result[offset];
    const before=sourceState(state,def.id);
    const entry={...before,lastAttempt:stamp(now),nextDue:nextSlot(now,def.minutes)};
    state.providers[def.id]=entry;
    if (attempt.status === "rejected") {
      const error=attempt.reason;
      entry.status="error";
      if (def.id === "gdelt") entry.primaryRetryAfter = Math.max(before.primaryRetryAfter || 0, error?.primaryRetryAfter || 0);
      entry.failures=Math.min(6,(before.failures || 0)+1);
      entry.detail=error?.status ? "Upstream HTTP "+error.status : "Feed could not be retrieved or validated.";
      entry.nextDue=Math.max(entry.nextDue,error?.retryAfter || 0);
      if (def.transient) entry.ids=[];
      continue;
    }
    successes++;
    const batch=attempt.value;
    Object.assign(entry,{status:"ok",lastSuccess:stamp(now),failures:0,detail:batch.detail || ""});
    if (def.id === "gdelt") {
      entry.primaryRetryAfter=batch.primaryRetryAfter || 0;
      if (Object.hasOwn(batch,"galEtag")) entry.galEtag=batch.galEtag;
    }
    const continuous=before.status==="ok" && now-Date.parse(before.lastSuccess)<=def.minutes*90000;
    entry.signalSchema=3;
    const observed=[];
    if (batch.unchanged) {addPoll(state,def.id,now,observed,continuous);continue;}
    entry.etag=batch.etag || null;
    entry.modified=batch.modified || null;
    const digest=createHash("sha256").update(JSON.stringify(batch.events.map(({observedAt,...rest})=>rest))).digest("hex");
    if (digest === before.digest && !def.transient) {addPoll(state,def.id,now,observed,continuous);continue;}
    entry.digest=digest;
    const ids=[];
    for (const received of batch.events) {
      // Zone-specific NWS updates keep their original record. Distinct zones can share a VTEC episode.
      const references=(received.origin?.references || []).map(url=>pool.get(byUrl.get(url))).filter(Boolean);
      const predecessor=references.find(e=>e.location===received.location);
      const id=byUrl.get(received.url) || bySeries.get(received.origin?.series) || predecessor?.id || byHeadline.get(fingerprint(received)) || received.id;
      let old=pool.get(id);
      const newNotice=(received.source==="National Weather Service" || received.gdacs) && old && old.url!==received.url;
      if (newNotice && old.updatedAt>received.updatedAt) old=undefined;
      const combined=combine(old,received,stamp(now));
      if (newNotice) {combined.id=received.id;combined.publishedAt=received.publishedAt;}
      let next=received.transient ? combined : observe(old,combined,received,now,continuous);
      if (received.origin?.areaAction) next=observeExpansion(next,previousAreas,before.lastSuccess,now,continuous);
      if (received.editorialType==="correction") next=linkCorrection(next,pool.get(byUrl.get(received.supersedes?.url)),now,continuous);
      if(!old) observed.push(next);
      pool.set(next.id,next);
      byUrl.set(received.url,next.id);
      index(next);
      ids.push(next.id);
      if (!next.transient && JSON.stringify(old) !== JSON.stringify(next)) changed.set(next.id,next);
    }
    addPoll(state,def.id,now,observed,continuous);
    entry.ids=[...new Set(def.replace ? ids : [...ids,...(before.ids || [])])].slice(0,180);
  }
  const activeIds=new Set(defs.filter(def=>!def.disabled).flatMap(def=>sourceState(state,def.id).ids || []));
  state.events=[...pool.values()].filter(e=>activeIds.has(e.id) && (now-Date.parse(e.updatedAt)<45*DAY || e.expiresAt && Date.parse(e.expiresAt)>now));
  state.hotArchive = retiredHotMembers(priorHot, activeIds, defs, now);
  retainEpisodeChanges(state,now);
  const byDay=new Map();
  for (const event of changed.values()) {
    const day=event.id.slice(0,10);
    if (!byDay.has(day)) byDay.set(day,[]);
    byDay.get(day).push(event);
  }
  await processInBatches([...byDay.keys()],8,day=>updateDay(store,day,byDay.get(day)));
  state.days=[...new Set([...state.days,...byDay.keys()])].sort().reverse();
  if (successes) {state.updatedAt=stamp(now);state.lastSignalScan=state.updatedAt;}
  const enabled=defs.filter(def=>!def.disabled).length;
  const scan={
    startedAt:stamp(now), finishedAt:stamp(now+Math.max(0,Date.now()-started)), nextScheduledAt,
    configured:defs.length, enabled, checked:due.length, succeeded:successes,
    failed:due.length-successes, deferred:enabled-due.length, changed:changed.size,
    events:state.events.length, archiveDays:byDay.size, exampleArchivedId:changed.keys().next().value || null,
  };
  // The receipt becomes visible atomically with this snapshot, after the archive writes.
  state.recentScans=[scan,...(state.recentScans || [])].slice(0,12);
  if (!await writeConditionally(store,SNAPSHOT_KEY,state,previous)) throw new Error("Collector snapshot superseded. Retry on next schedule.");
  return scan;
}
function matches(event,params) {
  if (params.type && params.type !== "all" && event.editorialType !== params.type) return false;
  const words=fold(params.q || "").split(/\s+/).filter(Boolean);
  const corpus=fold([event.title,event.summary,event.location,event.category,event.source,...event.timeline.map(t=>t.text)].join(" "));
  if (!words.every(w=>corpus.includes(w))) return false;
  if (params.scope === "conspiracy") return event.topicClaim;
  return !params.scope || params.scope === "all" || event.scope === params.scope;
}
function responseEvent(event,detail) {
  const {interest,interestType,expiresAt,observedAt,observations,origin,transient,topicClaim,...rest}=event;
  return {...rest,expiresAt,topicClaim,timeline:detail ? event.timeline : event.timeline.slice(-8)};
}
const archivePointer = /^(\d{4}-\d{2}-\d{2}):(\d{1,6})$/;
export function parseFeedParams(url) {
  const p=url.searchParams;
  const query={type:p.get("type") || "all",view:p.get("view") || "briefing",scope:p.get("scope") || "all",q:(p.get("q") || "").trim(),
    location:(p.get("location") || "Maui").trim(),id:p.get("id") || "",cursor:p.get("cursor") || "",limit:Number(p.get("limit") || 100)};
  if ((query.type !== "all" && !Object.hasOwn(editorialTypes,query.type)) || !["briefing","trending","rabbit","archive","signals"].includes(query.view) || !["all","local","us","global","conspiracy"].includes(query.scope)
    || query.q.length>220 || query.location.length>100 || (query.id && !validId(query.id)) || !Number.isInteger(query.limit)
    || query.limit<1 || query.limit>200 || (query.cursor && !(/^\d{1,6}$/.test(query.cursor) || archivePointer.test(query.cursor)))) throw new Error("Invalid feed parameters.");
  return query;
}
async function archivePage(store,days,params,now) {
  const pointer=archivePointer.exec(params.cursor || "");
  let dayIndex=pointer ? days.indexOf(pointer[1]) : 0;
  if (dayIndex<0) return {events:[],nextCursor:null};
  let offset=pointer ? Number(pointer[2]) : 0;
  let scanned=0;
  const events=[];
  while(dayIndex<days.length && scanned<16) {
    const day=days[dayIndex];
    const records=(await store.get(dayKey(day),{type:"json"}) || []).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
    for (;offset<records.length;offset++) {
      const event=ranked(records[offset],now,params.location);
      if (!matches(event,params)) continue;
      events.push(responseEvent(event,false));
      if (events.length>=params.limit) return {events,nextCursor:offset+1<records.length ? day+":"+(offset+1) : days[dayIndex+1] ? days[dayIndex+1]+":0" : null};
    }
    dayIndex++;
    offset=0;
    scanned++;
  }
  return {events,nextCursor:days[dayIndex] ? days[dayIndex]+":0" : null};
}

function briefingOrder(rankedEvents,now) {
  const leads=[];
  const used=new Set();
  const eligible=rankedEvents.filter(e=>now-Date.parse(e.updatedAt)<=7*DAY);
  function select(event) {if (event && !used.has(event.id)) {leads.push(event);used.add(event.id);}}
  eligible.filter(e=>e.severity==="high").slice(0,2).forEach(select);
  const categories=new Set();
  for (const event of eligible) {
    if (!categories.has(event.category)) {select(event);categories.add(event.category);}
  }
  return [...leads,...rankedEvents.filter(e=>!used.has(e.id))];
}
export async function searchEvents(input={}, {store=repository(),now=Date.now(),defs=definitions()}={}) {
  const params={view:"briefing",scope:"all",location:"Maui",limit:100,...input};
  params.limit=Math.max(1,Math.min(200,Number(params.limit) || 100));
  const state=checkSchema(await store.get(SNAPSHOT_KEY,{type:"json"}));
  const health=sourceHealth(state,defs,now);
  const metadata={updatedAt:state.updatedAt,health,recentScans:state.recentScans || []};
  const active=new Set(defs.filter(def=>!def.disabled && (!def.transient || now-Date.parse(sourceState(state,def.id).lastSuccess)<20*60000)).flatMap(def=>sourceState(state,def.id).ids || []));
  const live=state.events.filter(e=>active.has(e.id));
  if (params.id) {
    if (!validId(params.id)) return {...metadata,events:[],nextCursor:null};
    const archived=live.find(e=>e.id===params.id) || (await store.get(dayKey(params.id.slice(0,10)),{type:"json"}))?.find(e=>e.id===params.id);
    if (!archived) return {...metadata,events:[],nextCursor:null};
    let detail={...ranked(archived,now,params.location),intelligence:annotate(archived,now,params.location) || undefined};
    if (archived.source==="National Weather Service") {
      const key=incidentKey(archived);
      const siblings=live.filter(e=>e.id!==archived.id && incidentKey(e)===key && Date.parse(e.expiresAt)>now);
      detail=collapseBulletins([detail,...siblings])[0];
    }
    return {...metadata,events:[responseEvent(detail,true)],nextCursor:null};
  }
  if (params.view === "archive") return {...metadata,...await archivePage(store,state.days,params,now)};
  if (params.view==="signals" || params.view==="trending") {
    const retired = params.view === "trending"
      ? await readRetiredHot(state.hotArchive, active, defs, now, day => store.get(dayKey(day), {type:"json"}))
      : [];
    const desk=signalDesk(live,state,health,now,params.location,retired);
    const selected=(params.view==="signals"?desk.events:desk.hotEvents).filter(e=>matches(e,params));
    const start=/^\d{1,6}$/.test(params.cursor || "") ? Number(params.cursor) : 0;
    return {...metadata,total:selected.length,...(params.view==="signals"?{intelligence:desk.intelligence}:{}),
      events:selected.slice(start,start+params.limit).map(e=>responseEvent(e,false)),
      nextCursor:start+params.limit<selected.length ? String(start+params.limit) : null};
  }
  let events=live.filter(e=>(!e.expiresAt || Date.parse(e.expiresAt)>now) && (!e.transient || params.view === "rabbit" || params.scope === "conspiracy"))
    .filter(e=>params.view !== "rabbit" || e.topicClaim)
    .map(e=>ranked(e,now,params.location)).filter(e=>matches(e,params));
  const compare=(a,b)=>b.rank-a.rank || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
  events.sort(compare);
  if (params.view === "briefing" && params.scope === "all") {
    // Reserve space in the first page for every region during high-volume hazard days.
    const groups=["local","us","global"].map(s=>briefingOrder(events.filter(e=>e.scope===s),now));
    const take=Math.max(1,Math.floor(params.limit/3));
    const lead=groups.flatMap(group=>group.slice(0,take));
    const chosen=new Set(lead.map(e=>e.id));
    const extra=events.filter(e=>!chosen.has(e.id));
    events=[...lead,...extra];
  } else if (params.view === "briefing") {
    events=briefingOrder(events,now);
  }
  if (params.view === "briefing") events=collapseBulletins(events);
  const start=/^\d{1,6}$/.test(params.cursor || "") ? Number(params.cursor) : 0;
  return {...metadata,events:events.slice(start,start+params.limit).map(e=>responseEvent(e,false)),nextCursor:start+params.limit<events.length ? String(start+params.limit) : null};
}
