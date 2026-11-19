import { parseFeedParams, searchEvents } from "../../server/feeds/store.mjs";

const json = (body, status, headers = {}) =>
  Response.json(body, {
    status,
    headers: {
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
export function createFeedHandler(search = searchEvents) {
  return async (request) => {
    if (request.method !== "GET")
      return json({ error: "Use GET." }, 405, { Allow: "GET" });
    let params;
    try {
      params = parseFeedParams(new URL(request.url));
    } catch {
      return json({ error: "Invalid feed parameters." }, 400);
    }
    try {
      const result = await search(params);
      const social =
        params.view === "rabbit" || params.scope === "conspiracy" || params.id;
      const timeSensitive = params.view === "signals" || params.view === "trending";
      return json(
        result,
        200,
        social
          ? {}
          : {
              "Cache-Control": "public, max-age=15",
              "Netlify-CDN-Cache-Control": timeSensitive
                ? "public, s-maxage=30, stale-while-revalidate=15, must-revalidate"
                : "public, s-maxage=30, stale-while-revalidate=60, stale-if-error=86400",
              "Netlify-Vary": "query",
            },
      );
    } catch (error) {
      console.error("Reporting store unavailable", error?.name);
      return json(
        { error: "The reporting archive is temporarily unavailable." },
        503,
        { "Retry-After": "45" },
      );
    }
  };
}
export default createFeedHandler();
export const config = {
  path: "/api/feed",
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
