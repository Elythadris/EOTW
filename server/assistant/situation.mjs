import { getStore } from "@netlify/blobs";
import { searchEvents } from "../feeds/store.mjs";
import { boundedString, errorResponse, setting } from "./http.mjs";
import { dailyLimits, reserve } from "./quota.mjs";
import { provider } from "./answer.mjs";
import { providerProblem } from "./passages.mjs";
import { briefingMaterial, cachedBrief, DEFAULT_LOCATION, fallbackBrief, HOUR, makeEntry, validateSituation } from "./situation-model.mjs";

const currentKey = "v1/maui/latest";
const slotKey = "v1/maui/scheduled-slot";
const openStore = () => getStore({name:"eotw-situation-v1",consistency:"strong"});
const isDefault = location => ["maui", "maui, hawaii","maui, hi"].includes(location.toLowerCase());
const publicHeaders = {
  "cache-control":"public, max-age=0, must-revalidate",
  "netlify-cdn-cache-control":"public, s-maxage=30, stale-while-revalidate=30",
  "netlify-vary":"query=location",
  "x-content-type-options":"nosniff",
};
const dependencies = { search:searchEvents, storage:openStore, clock:Date.now, model:provider, permit:reserve, env:setting };

export async function readSituation(request, context, injected = {}) {
  if (!["GET","HEAD"].includes(request.method)) return new Response(null, {status:405,headers:{allow:"GET, HEAD"}});
  const {search,storage,clock} = {...dependencies,...injected};
  try {
    const location = boundedString(new URL(request.url).searchParams.get("location") || DEFAULT_LOCATION,100,"location");
    const now = clock();
    const defaultReader = isDefault(location) && context?.deploy?.context === "production";
    const [cached,current] = await Promise.allSettled([
      defaultReader ? Promise.resolve().then(() => storage().get(currentKey,{type:"json"})) : Promise.resolve(null),
      briefingMaterial(search, location, now),
    ]);
    const entry = cached.status === "fulfilled" ? cached.value : null;
    const material = current.status === "fulfilled" ? current.value : null;
    let brief = defaultReader && cachedBrief(entry,material,now);
    if (!brief && material) {
      const reason = entry?.brief && entry.fingerprint !== material.fingerprint
        ? "The qualifying signal mix changed. Showing current source records."
        : "Source briefing from the current qualifying signals.";
      brief = fallbackBrief(material,now,reason);
    }
    if (!brief) return Response.json({error:"The situation briefing is temporarily unavailable."},{status:503,headers:{"cache-control":"no-store","retry-after":"60"}});
    return new Response(request.method === "HEAD" ? null : JSON.stringify(brief), {
      headers:{...publicHeaders,"content-type":"application/json; charset=utf-8"},
    });
  } catch (error) { return errorResponse(error); }
}

function briefingLimit(env) {
  const raw = env("AI_BRIEFING_DAILY_LIMIT");
  if (raw === undefined || raw === "") return 4;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? Math.min(4,value) : 0;
}

export async function generateSituation(context, injected = {}) {
  if (context?.deploy?.context !== "production") return {status:"preview"};
  const {search,storage,clock,model,permit,env} = {...dependencies,...injected};
  const start = clock();
  const slot = Math.floor(start / (6 * HOUR));
  const store = storage();
  const previous = await store.getWithMetadata(slotKey,{type:"json"});
  const old = previous?.data;
  const sameSlot = old?.slot === slot;
  const legacy = sameSlot && !old.status;
  const attempts = sameSlot ? (old.attempt || 1) : 0;
  const fiveMinutes = 5 * 60000;
  if (old?.slot > slot || (sameSlot && !legacy && (attempts >= 2 ||
      !["retry","running"].includes(old.status) || Math.floor(start/fiveMinutes) <= Math.floor(old.startedAt/fiveMinutes) || start - old.startedAt < 30000))) {
    return {status:"already-checked"};
  }
  const limit = briefingLimit(env);
  const limits = dailyLimits(env);
  if (!limit || !limits.global) return {status:"disabled"};
  const generate = model(env,context,{briefing:true});
  if (!generate) return {status:"provider-unavailable"};
  const [material, cached] = await Promise.all([
    briefingMaterial(search,DEFAULT_LOCATION,start), store.get(currentKey,{type:"json"}),
  ]);
  if (!material.records.length || !material.updatedAt || start - Date.parse(material.updatedAt) > HOUR) return {status:"awaiting-current-reports"};
  if (clock() - start > 10000) return {status:"deferred"};
  // A legacy slot has no terminal status. A saved edition from its window proves success,
  // otherwise one migration recovery is eligible within the same unchanged daily quotas.
  if (legacy && cached?.brief?.generatedAt && Math.floor(Date.parse(cached.brief.generatedAt)/(6*HOUR)) === slot) {
    return {status:"already-checked"};
  }
  const state = {slot,attempt:attempts+1,startedAt:start,status:"running"};
  const write = await store.setJSON(slotKey,state,previous ? {onlyIfMatch:previous.etag} : {onlyIfNew:true});
  if (!write.modified) return {status:"already-checked"};
  const finish = async (status, meta = {}, retry = false) => {
    // The next HTTP-accessible code path is read-only. Only a later scheduled tick
    // can claim this retry, and every attempt must acquire new site and service permits.
    const persistedStatus = retry && state.attempt < 2 ? "retry" : status;
    await store.setJSON(slotKey,{...state,status:persistedStatus,outcome:status,...meta},
      write.etag ? {onlyIfMatch:write.etag} : {});
    return {status,attempt:state.attempt,elapsedMs:clock()-start,...meta};
  };
  const timestamp = new Date(start).toISOString();
  if (cached?.fingerprint === material.fingerprint && cachedBrief(cached,material,start)) {
    await store.setJSON(currentKey,{...cached,checkedAt:timestamp});
    return finish("unchanged");
  }
  const allowed = await permit({
    ip:"service:scheduled-situation",site:context.site?.id || "", limits:{global:limits.global,visitor:limit}, now:new Date(start),
    // Budget pruning runs outside the short scheduled invocation in regular reader requests.
  });
  if (!allowed) return finish("budget");
  if (clock() - start > 9000) return finish("deadline",{},true);
  let raw;
  try {
    raw = await generate({location:DEFAULT_LOCATION,localSignalPresent:material.records.some(record => record.scope === "local")},material.records);
  } catch (error) {
    const problem = providerProblem(error);
    const canRetry = !problem.httpStatus ? !["refusal","upstream-filter"].includes(problem.category) :
      [408,409,429].includes(problem.httpStatus) || problem.httpStatus >= 500;
    return finish("provider-failure",problem,canRetry);
  }
  let reason = "invalid-selection";
  const content = validateSituation(raw,material.records,code => {reason=code;});
  if (!content) return finish("unsupported-answer",{reason},true);
  const brief = {location:DEFAULT_LOCATION,mode:"ai",generatedAt:timestamp,updatedAt:material.updatedAt,stale:false,notice:"Scheduled AI briefing from the cited reports.",...content};
  await store.setJSON(currentKey,makeEntry(brief,material,timestamp));
  return finish("published",{sourceCount:content.citations.length});
}
