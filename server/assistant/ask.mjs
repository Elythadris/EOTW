import { searchEvents } from "../feeds/store.mjs";
import { errorResponse, readJson, reply, setting } from "./http.mjs";
import { inputContext, selectedEvidence } from "./data-context.mjs";
import { inputQuery, retrieve } from "./retrieval.mjs";
import { providerProblem } from "./passages.mjs";
import { dailyLimits, reserve } from "./quota.mjs";
import { groundedAnswer, provider, sourceAnswer } from "./answer.mjs";

export function askHandler({
  search = searchEvents,
  contextEvidence = selectedEvidence,
  model = provider,
  permit = reserve,
  env = setting,
} = {}) {
  return async (request, context) => {
    if (request.method !== "POST")
      return reply({ error: "Use POST." }, 405, { Allow: "POST" });
    try {
      const body = await readJson(request, 32768);
      const query = inputQuery(body);
      const focus = inputContext(body.context);
      const records = focus ? await contextEvidence(focus) : await retrieve(query, search);
      if (!records.length) return reply(focus ? {
        mode:"sources",answer:"The provider has no citable data for this selection. Check the source shown on the chart or forecast.",citations:[],
      } : sourceAnswer([], "offline"));
      const generate = model(env, context);
      if (!generate) return reply(sourceAnswer(records, "offline", query));
      try {
        const ok = await permit({
          ip: context?.ip,
          site: context?.site?.id || "",
          limits: dailyLimits(env),
          context,
        });
        if (!ok) return reply(sourceAnswer(records, "budget", query));
      } catch {
        console.warn("EOTW AI permit storage unavailable");
        return reply(sourceAnswer(records, "budget", query));
      }
      const startedAt = Date.now();
      try {
        const result = await generate(focus ? {...query,context:focus} : query, records);
        return reply(
          groundedAnswer(result, records, reason => console.warn("EOTW answer validation", {reason, elapsedMs:Date.now()-startedAt})) || sourceAnswer(records, "unchecked", query),
        );
      } catch (error) {
        console.warn("EOTW answer provider", {...providerProblem(error), elapsedMs:Date.now()-startedAt});
        return reply(sourceAnswer(records, "unchecked", query));
      }
    } catch (error) {
      return errorResponse(error);
    }
  };
}
