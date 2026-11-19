import { getStore } from "@netlify/blobs";
import { searchEvents } from "../feeds/store.mjs";
import { boundedString, errorResponse, setting } from "./http.mjs";
import { dailyLimits, reserve } from "./quota.mjs";
import { provider } from "./answer.mjs";
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
  if (previous && previous.data.slot >= slot) return {status:"already-checked"};
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
  // Each six-hour window owns one generation opportunity, even on concurrent invocations or redeploys.
  const write = await store.setJSON(slotKey,{slot},previous ? {onlyIfMatch:previous.etag} : {onlyIfNew:true});
  if (!write.modified) return {status:"already-checked"};
  const timestamp = new Date(start).toISOString();
  if (cached?.fingerprint === material.fingerprint && cachedBrief(cached,material,start)) {
    await store.setJSON(currentKey,{...cached,checkedAt:timestamp});
    return {status:"unchanged"};
  }
  const allowed = await permit({
    ip:"service:scheduled-situation",site:context.site?.id || "", limits:{global:limits.global,visitor:limit}, now:new Date(start),
    // Budget pruning runs outside the short scheduled invocation in regular reader requests.
  });
  if (!allowed) return {status:"budget"};
  if (clock() - start > 14000) return {status:"deadline"};
  const raw = await generate({location:DEFAULT_LOCATION,localSignalPresent:material.records.some(record => record.scope === "local"),task:"Summarize only these qualifying public signals; if none is local, do not imply the national or world reports are local."},material.records);
  const content = validateSituation(raw,material.records);
  if (!content) return {status:"unsupported-answer"};
  const brief = {location:DEFAULT_LOCATION,mode:"ai",generatedAt:timestamp,updatedAt:material.updatedAt,stale:false,notice:"Scheduled AI briefing from the cited reports.",...content};
  await store.setJSON(currentKey,makeEntry(brief,material,timestamp));
  return {status:"published",sourceCount:content.citations.length};
}
