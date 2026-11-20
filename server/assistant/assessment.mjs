import { getStore } from "@netlify/blobs";
import { validId } from "../feeds/model.mjs";
import { searchEvents } from "../feeds/store.mjs";
import { provider } from "./answer.mjs";
import { applyModelSelection, assessmentMaterial, modelInput, sourceAssessment } from "./assessment-model.mjs";
import { boundedString, digest, errorResponse, reply, setting } from "./http.mjs";
import { providerProblem } from "./passages.mjs";
import { dailyLimits, reserve } from "./quota.mjs";

const openStore = () => getStore({name:"eotw-event-assessments-v1",consistency:"strong"});
const deps = {search:searchEvents,storage:openStore,model:provider,permit:reserve,env:setting,clock:Date.now};
const minute = 60000;

async function compare(material, context, {storage,model,permit,env,clock}) {
  const current = () => sourceAssessment(material);
  if (!material.modelEligible || context?.deploy?.context !== "production") return current();
  const modelCall = model(env,context,{assessment:true});
  if (!modelCall) return current();
  const now = clock();
  // A bounded set of 512 slots keeps only selections and reference IDs. Every
  // response is rendered anew against the current source text and fingerprint.
  const key = "v1/" + (parseInt(digest(material.base.eventId).slice(0,5),16) % 512);
  const store = storage();
  const previous = await store.getWithMetadata(key,{type:"json"});
  const entry = previous?.data;
  const same = entry?.fingerprint === material.fingerprint;
  if (same && entry.result) {
    const checked = applyModelSelection(entry.result,material);
    if (checked) return checked;
  }
  if (entry?.until > now && (same || entry.state === "running")) return current();
  const lock = await store.setJSON(key,{fingerprint:material.fingerprint,state:"running",until:now+minute},
    previous ? {onlyIfMatch:previous.etag} : {onlyIfNew:true});
  if (!lock.modified || !lock.etag) return current();
  const finish = async (data) => store.setJSON(key,{fingerprint:material.fingerprint,...data},{onlyIfMatch:lock.etag});
  const allowed = await permit({ip:context.ip,site:context.site?.id || "",context,limits:dailyLimits(env),now:new Date(now)});
  if (!allowed) {
    // A reader-specific quota must not impose a cooldown on other readers.
    await finish({state:"idle",until:0});
    return sourceAssessment(material,"Source-based assessment. The current AI allowance is unavailable. Alternatives below are research questions.");
  }
  try {
    const result = await modelCall(modelInput(material),[]);
    const checked = applyModelSelection(result,material);
    if (checked) {
      // Persist the validated selectors only. A model cannot inject additional fields
      // into the cache, citations, public facts, or the language of an allegation.
      const compact = {hypotheses:result.hypotheses.map(({id,support,against})=>({id,support,against}))};
      await finish({state:"ready",result:compact});
      return checked;
    }
    console.warn("EOTW assessment rejected ungrounded selection");
  } catch (error) {
    console.warn("EOTW assessment provider",providerProblem(error));
  }
  await finish({state:"cooldown",until:now+5*minute});
  return sourceAssessment(material,"Source-based assessment. A validated AI comparison is unavailable for this revision.");
}

export function assessmentHandler(overrides = {}) {
  const dependencies = {...deps,...overrides};
  return async (request, context) => {
    if (!["GET","HEAD"].includes(request.method)) return reply({error:"Use GET or HEAD."},405,{allow:"GET, HEAD"});
    const query = new URL(request.url).searchParams;
    const id = query.get("id");
    if (!validId(id)) return reply({error:"A valid EOTW story ID is required."},400);
    try {
      const location = boundedString(query.get("location") || "Maui",100,"location");
      const result = await dependencies.search({view:"archive",id,location,limit:1});
      const event = result.events.find(e=>e.id === id || e.bulletins?.some(b=>b.id === id));
      if (!event) return reply({error:"This story is unavailable."},404);
      if (request.method === "HEAD") return new Response(null,{headers:{"cache-control":"private, no-store","content-type":"application/json; charset=utf-8"}});
      const material = assessmentMaterial(event);
      let assessment;
      try { assessment = await compare(material,context,dependencies); }
      catch (error) {
        // The event is still readable during a budget-store or AI-cache outage.
        console.warn("EOTW assessment cache or quota unavailable",{type:error?.name || "Error"});
        assessment = sourceAssessment(material,"Source-based assessment. Enrichment is temporarily unavailable.");
      }
      return reply({...assessment,eventId:id});
    } catch (error) { return errorResponse(error); }
  };
}
