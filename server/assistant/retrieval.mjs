import { boundedString, RequestError } from "./http.mjs";
import { cleanHistory } from "./preferences.mjs";

const common = new Set(
  "a about across after all an analyze and any archive are as at attention be been before break breaking broadly brief briefing by can compare connections could current currently describe details developments did do does emerging events evidence explain for from give going happening happened important has have headlines here historical how i in info information into investigate investigation is it its know latest local me more my near need news of on one or our out over overview plain please published recent records relates report reporting reports research said say should show sources stories story subject suggest support supported supporting supports summarize summary tell than that the their them there these they things this those timeline to today top under update updates us was we were what whats when where which who why will with world would you your".split(
    " ",
  ),
);
const normalize = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
function tokens(value) {
  return [
    ...new Set(
      normalize(value)
        .split(" ")
        .filter((term) => term.length > 1 && !common.has(term)),
    ),
  ].slice(0, 12);
}

export function inputQuery(body) {
  const filters = body.filters || {};
  if (!filters || typeof filters !== "object" || Array.isArray(filters))
    throw new RequestError(400, "Invalid map filters.");
  const scope = ["local", "us", "global", "conspiracy", "all"].includes(
    filters.scope,
  )
    ? filters.scope
    : "all";
  const view = ["briefing", "trending", "rabbit", "archive"].includes(
    filters.view,
  )
    ? filters.view
    : "briefing";
  return {
    question: boundedString(body.question, 800, "question"),
    location: boundedString(body.location ?? "Maui", 100, "location"),
    storyId: body.storyId ? boundedString(body.storyId, 160, "story") : "",
    history: cleanHistory(body.history || [])
      .slice(-6)
      .map((m) => ({ ...m, text: m.text.slice(0, 650) })),
    filters: {
      scope,
      view,
      category:
        typeof filters.category === "string"
          ? filters.category.slice(0, 80)
          : "",
      q: typeof filters.q === "string" ? filters.q.slice(0, 140) : "",
    },
  };
}

function publicUrl(raw) {
  try {
    const url = new URL(raw);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

function sourceCandidate(event) {
  if (/reddit/i.test(event.source) || !event.title || !publicUrl(event.url))
    return false;
  return !/(^|\.)(reddit\.com|redd\.it)$/i.test(new URL(event.url).hostname);
}

export async function retrieve(query, search) {
  let terms = tokens(query.question);
  const activeTopic = tokens(query.filters.q);
  if (activeTopic.length)
    terms = [...new Set([...activeTopic, ...terms])].slice(0, 12);
  if (
    !terms.length &&
    /\b(it|that|they|these|them|more|follow.up)\b/i.test(query.question)
  ) {
    terms = tokens(
      query.history.filter((message) => message.role === "user").at(-1)?.text ||
        "",
    );
  }
  const { scope, view, category } = query.filters;
  const lookup = { location: query.location, scope };
  const searches =
    query.storyId && !terms.length
      ? []
      : [search({ ...lookup, view, limit: 72 })];
  if (query.storyId)
    searches.push(
      search({ id: query.storyId, limit: 1, location: query.location }),
    );
  if (terms.length) {
    const keywords = terms.slice(0, 2);
    searches.push(
      search({ ...lookup, view: "archive", q: keywords.join(" "), limit: 18 }),
    );
    if (keywords.length > 1)
      searches.push(
        search({ ...lookup, view: "archive", q: keywords[0], limit: 12 }),
      );
  }
  const results = await Promise.allSettled(searches);
  if (results.every((result) => result.status === "rejected"))
    throw new Error("Feed storage unavailable");
  const candidates = new Map();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const event of result.value.events) {
      if (sourceCandidate(event)) candidates.set(event.id, event);
    }
  }
  const ranked = [];
  for (const event of candidates.values()) {
    const title = normalize(event.title);
    const body = normalize(
      [event.summary, event.category, event.source, event.location].join(" "),
    );
    const selected = event.id === query.storyId;
    if (
      !selected &&
      category &&
      !["all", "any"].includes(normalize(category)) &&
      normalize(category) !== normalize(event.category)
    )
      continue;
    const score = terms.reduce(
      (sum, word) =>
        sum + (title.includes(word) ? 4 : body.includes(word) ? 1 : 0),
      0,
    );
    if (!selected && terms.length && !score) continue;
    ranked.push({ event, score: (selected ? 100 : 0) + score });
  }
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.event.rank || 0) - Number(a.event.rank || 0) ||
      Date.parse(b.event.publishedAt) - Date.parse(a.event.publishedAt),
  );
  return ranked.slice(0, 6).map(({ event }, index) => ({
    id: String(index + 1),
    title: String(event.title).slice(0, 250),
    url: publicUrl(event.url),
    source: String(event.source).slice(0, 100),
    status: event.status,
    publishedAt: event.publishedAt,
    location: String(event.location || "").slice(0, 120),
    excerpt: String(event.summary || "").slice(0, 800),
    timeline: (event.timeline || [])
      .slice(-3)
      .map((item) => ({ at: item.at, text: String(item.text).slice(0, 180) })),
  }));
}
