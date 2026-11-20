import { link, plain } from "./model.mjs";

export const editorialTypes = Object.freeze({
  original: "Original reporting",
  investigation: "Investigation",
  prediction: "Prediction",
  correction: "Correction",
});
const root = "https://github.com/Elythadris/EOTW/blob/main/editorial/reports/";
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const slugPattern = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
function requiredText(value, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || !plain(value, maximum)) {
    throw new Error("Invalid editorial text");
  }
  return value.trim();
}
function instant(value, now) {
  if (!timestamp.test(value)) throw new Error("Editorial timestamps must be UTC");
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || millis > now || new Date(millis).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error("Invalid editorial publication or revision date");
  }
  return new Date(millis).toISOString();
}
function reference(entry, owner) {
  const url = link(entry?.url);
  if (!url.startsWith("https://") || url === owner) throw new Error("Invalid editorial citation");
  return { name: requiredText(entry.name, 90), url };
}
function findings(items, owner) {
  if (items === undefined) return [];
  if (!Array.isArray(items) || items.length > 4) throw new Error("Expected up to four attributed findings");
  return items.map(item => ({ ...reference(item, owner), finding: requiredText(item.finding, 420) }));
}
export function editorialRows(text, now = Date.now()) {
  const rows = JSON.parse(text);
  if (!Array.isArray(rows) || rows.length > 100) throw new Error("Expected at most 100 editorial records");
  const used = new Set();
  return rows.map((row) => {
    if (!row || typeof row !== "object" || !Object.hasOwn(editorialTypes, row.type)) throw new Error("Unknown editorial type");
    if (typeof row.slug !== "string" || row.slug.length > 140 || !slugPattern.test(row.slug) || used.has(row.slug)) {
      throw new Error("Invalid or duplicate editorial slug");
    }
    used.add(row.slug);
    const publishedAt = instant(row.publishedAt, now);
    const updatedAt = instant(row.updatedAt, now);
    if (!row.slug.startsWith(publishedAt.slice(0, 10) + "-") || updatedAt < publishedAt) throw new Error("Inconsistent editorial dates");
    const url = root + row.slug + ".md";
    if (!Array.isArray(row.sources) || row.sources.length < 1 || row.sources.length > 9) throw new Error("Editorial evidence is required");
    const sources = row.sources.map((entry) => reference(entry, url));
    const evidence = findings(row.evidence, url);
    const counterevidence = findings(row.counterevidence, url);
    const cited = new Set(sources.map(s => s.url));
    if ([...evidence, ...counterevidence].some(s => !cited.has(s.url))) throw new Error("Every finding must cite a listed source");
    const supersedes = row.supersedes ? reference(row.supersedes, url) : null;
    if (row.type === "correction" && !supersedes) throw new Error("A correction must identify the superseded record");
    if (row.scope && !["us", "global"].includes(row.scope)) throw new Error("Invalid editorial scope");
    if (row.status && !["confirmed", "developing", "speculation"].includes(row.status)) throw new Error("Invalid editorial status");
    if (row.topicClaim !== undefined && typeof row.topicClaim !== "boolean") throw new Error("topicClaim must be a boolean");
    if (row.referenceOnly !== undefined && typeof row.referenceOnly !== "boolean") throw new Error("referenceOnly must be a boolean");
    const author = requiredText(row.byline, 80);
    return {
      title: requiredText(row.title, 240),
      summary: requiredText(row.summary, 640),
      source: "EOTW editorial desk",
      byline: author,
      url,
      category: editorialTypes[row.type],
      editorialType: row.type,
      topicClaim: row.topicClaim === true,
      referenceOnly: row.referenceOnly === true,
      publishedAt,
      updatedAt,
      status: row.type === "prediction" ? "speculation" : row.status || "developing",
      scope: row.scope || "global",
      location: row.location ? requiredText(row.location, 100) : "",
      supersedes,
      evidence,
      counterevidence,
      sources: supersedes ? [...sources, { name: "Superseded · " + supersedes.name, url: supersedes.url }] : sources,
      originLabel: editorialTypes[row.type] + " published by EOTW.",
    };
  });
}
