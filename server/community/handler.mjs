import { getStore } from "@netlify/blobs";
import { getUser } from "@netlify/identity";
import { errorResponse, readJson, reply, RequestError, scopeName, setting } from "../assistant/http.mjs";
import { activeBoard, applyAction, member, readAction, topicById, view } from "./board.mjs";

const key = "v1/discussions";

export function communityHandler({
  storage = context => getStore({ name: "eotw-community-" + scopeName(context), consistency: "strong" }),
  accountEnabled = () => setting("EOTW_IDENTITY_ENABLED") === "true",
  identify = getUser,
  clock = Date.now,
} = {}) {
  return async (request, context) => {
    try {
      if (!["GET", "POST"].includes(request.method))
        return reply({ error: "Use GET or POST." }, 405, { Allow: "GET, POST" });
      const topic = topicById(new URL(request.url).searchParams.get("topic") ?? "maui");
      const writing = request.method === "POST";
      const action = writing ? readAction(await readJson(request, 6_144)) : null;
      const enabled = accountEnabled();
      let actor = null;
      let unavailable = false;
      if (enabled) {
        try { actor = member(await identify(), scopeName(context)); }
        catch (error) {
          if (writing) throw error;
          unavailable = true;
        }
      }
      if (writing && !enabled) throw new RequestError(503, "Account posting is unavailable.");
      if (writing && !actor) throw new RequestError(401, "Sign in to participate in the discussion.");
      const store = storage(context);
      for (let attempt = 0; attempt < 5; attempt++) {
        const row = await store.getWithMetadata(key, { type: "json" });
        const now = clock();
        const board = activeBoard(row?.data, now);
        if (!writing || !applyAction(board, topic, actor, action, now))
          return reply(view(board, topic, actor, enabled, unavailable));
        const condition = row ? { onlyIfMatch: row.etag } : { onlyIfNew: true };
        const result = await store.setJSON(key, board, condition);
        if (result.modified) return reply(view(board, topic, actor, enabled), action.action === "post" ? 201 : 200);
      }
      throw new RequestError(503, "Discussion changed quickly. Please try again.");
    } catch (error) {
      return errorResponse(error);
    }
  };
}
