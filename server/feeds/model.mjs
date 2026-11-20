import { broadLocation } from "./geography.mjs";
import { createHash } from "node:crypto";

export const HOUR = 3600000;
export const DAY = HOUR * 24;
export const fold = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[ʻ‘’']/g, "")
    .toLowerCase();
const claimTopics =
  /\b(qanon|q anon|uaps?|ufos?|unidentified anomalous phenomena|unidentified flying objects?|whistleblowers?|government secrecy|conspiracy theor(?:y|ies)|unexplained phenomena)\b/i;
const usPlace =
  /\b(united states|washington,? d\.?c|alaska|california|hawaii|puerto rico|utah|nevada|oklahoma|oregon|texas|wyoming|idaho|montana|washington|new mexico|tennessee|arkansas|kansas|colorado|virgin islands)\b|,\s*(?:AK|AL|AR|AZ|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|PR|RI|SC|SD|TN|TX|UT|VA|VI|VT|WA|WI|WV|WY)\b/;
const cleanSpace = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
export function plain(value, max = 500) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return cleanSpace(
    String(value)
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(
        /&(?:nbsp|amp|quot|apos|lt|gt|#39|#8217|#8216|#8211|#8212|#8220|#8221);/g,
        (x) =>
          ({
            "&nbsp;": " ",
            "&amp;": "&",
            "&quot;": '"',
            "&apos;": "'",
            "&lt;": "<",
            "&gt;": ">",
            "&#39;": "'",
            "&#8217;": "’",
            "&#8216;": "‘",
            "&#8211;": "–",
            "&#8212;": "—",
            "&#8220;": "“",
            "&#8221;": "”",
          })[x],
      ),
  ).slice(0, max);
}
export function link(value) {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.href.length > 2000
    )
      return "";
    for (const key of [...url.searchParams.keys()])
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}
export function date(value) {
  if (!value || !["number", "string"].includes(typeof value)) return null;
  const timestamp = new Date(value);
  return Number.isFinite(+timestamp) ? timestamp.toISOString() : null;
}
export function record(raw, now = Date.now()) {
  const url = link(raw.url);
  const title = plain(raw.title, 260);
  const publishedAt = date(raw.publishedAt);
  if (!url || !title || !publishedAt || Date.parse(publishedAt) > now + 300000)
    return null;
  const source = plain(raw.source, 90);
  const broad = broadLocation(raw, title);
  const location = plain(raw.location, 300) || broad?.name || "";
  const updated = date(raw.updatedAt);
  const updatedAt =
    updated && updated >= publishedAt && Date.parse(updated) <= now + 300000
      ? updated
      : publishedAt;
  const id =
    publishedAt.slice(0, 10) +
    "-" +
    createHash("sha256").update(url).digest("hex").slice(0, 20);
  const coords = raw.coords;
  const mapped =
    Array.isArray(coords) &&
    coords.length >= 2 &&
    Number.isFinite(coords[0]) &&
    Number.isFinite(coords[1]) &&
    Math.abs(coords[0]) <= 180 &&
    Math.abs(coords[1]) <= 90 &&
    raw.natural === true;
  const sources = [
    { name: source, url },
    ...(raw.sources || []).map((item) => ({
      name: plain(item.name, 90),
      url: link(item.url),
    })),
  ];
  const status = raw.status || "developing";
  const news = ["World", "News discovery", "Analysis"].includes(raw.category);
  let category = plain(raw.category, 80) || "Reporting";
  if (
    news &&
    /\b(ceasefire|peace talks|armed conflict|airstrikes?|invasion|humanitarian corridor|military exercises?)\b/i.test(
      title,
    )
  )
    category = "Conflict reporting";
  else if (
    news &&
    /\b(evacuations?|declared emergency|state of emergency|major incident)\b/i.test(
      title,
    )
  )
    category = "Emergency reporting";
  else if (news && /\b(cyber attacks?|cyberattacks?|ransomware|data breach)\b/i.test(title)) category = "Cyber reporting";
  else if (news && /\b(power grid|power outage|water outage|pipeline failure|transport disruption|internet outage|undersea cable)\b/i.test(title)) category = "Infrastructure reporting";
  else if (news && claimTopics.test(title)) category = "Claim coverage";
  return {
    id,
    title,
    summary: plain(raw.summary, 650),
    url,
    source,
    publishedAt,
    updatedAt,
    category,
    ...(raw.origin ? { origin: raw.origin } : {}),
    ...(raw.gdacs ? { gdacs:raw.gdacs,origin:{series:"gdacs:"+raw.gdacs.type+":"+raw.gdacs.eventId} } : {}),
    ...(raw.alertArea && raw.source === "National Weather Service" ? { alertArea: raw.alertArea } : {}),
    ...(raw.editorialType ? {
      editorialType: raw.editorialType,
      ...(raw.referenceOnly ? { referenceOnly:true } : {}),
      byline: raw.byline,
      supersedes: raw.supersedes,
      ...(raw.evidence?.length ? { evidence: raw.evidence } : {}),
      ...(raw.counterevidence?.length ? { counterevidence: raw.counterevidence } : {}),
    } : {}),
    scope:
      raw.scope === "us" ||
      usPlace.test(location) ||
      usPlace.test(fold(location))
        ? "us"
        : raw.scope || "global",
    location,
    lat: mapped ? coords[1] : (broad?.coords[1] ?? null),
    lon: mapped ? coords[0] : (broad?.coords[0] ?? null),
    coordinatePrecision: mapped
      ? raw.boundary
        ? "source-boundary"
        : "source-point"
      : broad?.precision || null,
    mapNote: mapped
      ? raw.boundary
        ? "Representative vertex of the published hazard boundary. See the source for the full affected area."
        : "Hazard coordinates supplied by " + source + "."
      : broad?.note || "",
    status,
    severity: raw.severity || "routine",
    severityReason: plain(raw.severityReason, 160),
    sources: [
      ...new Map(
        sources.filter((s) => s.name && s.url).map((s) => [s.url, s]),
      ).values(),
    ].slice(0, 12),
    timeline: [
      {
        at: publishedAt,
        text: plain(raw.originLabel, 80) || "Source published this record.",
      },
    ],
    rank: 0,
    rankReasons: [],
    topicClaim: raw.topicClaim === true || claimTopics.test(title),
    interest: Number.isFinite(raw.interest) ? Math.max(0, raw.interest) : 0,
    interestType: plain(raw.interestType, 50),
    expiresAt: date(raw.expiresAt),
    transient: raw.transient === true,
    observedAt: raw.discovered ? new Date(now).toISOString() : null,
  };
}
export function combine(old, next, at) {
  if (!old) return next;
  if (next.editorialType && next.updatedAt < old.updatedAt) return old;
  if (next.editorialType) at = next.updatedAt;
  const useNext = next.updatedAt >= old.updatedAt;
  const primary = useNext ? next : old;
  const timeline = [...old.timeline];
  const urls = new Set(old.sources.map((s) => s.url));
  const sources = [...old.sources];
  for (const s of next.sources) {
    if (!urls.has(s.url) && sources.length < 12) {
      sources.push(s);
      if (!old.sources.some((item) => item.name === s.name))
        timeline.push({
          at,
          text: "Additional coverage indexed from " + s.name + ".",
        });
    }
  }
  if (
    useNext &&
    (old.title !== next.title ||
      old.summary !== next.summary ||
      old.severity !== next.severity ||
      old.status !== next.status)
  ) {
    timeline.push({
      at,
      text:
        "Prior edition: " +
        old.title +
        (old.summary ? " — " + old.summary : ""),
    });
    timeline.push({ at, text: "Source revision: " + next.title });
  } else if (useNext && next.updatedAt > old.updatedAt) {
    timeline.push({ at: next.updatedAt, text: "Source updated its record." });
  }
  return {
    ...primary,
    id: old.id,
    publishedAt: old.publishedAt,
    observedAt: old.observedAt || next.observedAt,
    sources: next.editorialType ? primary.sources : sources,
    timeline: timeline.filter(
      (entry, i) =>
        timeline.findIndex(
          (item) => item.at === entry.at && item.text === entry.text,
        ) === i,
    ),
  };
}
export function scopeFor(event, location = "Maui") {
  const place = fold(location).split(",")[0].trim();
  const text = fold([event.title, event.location].join(" "));
  if (["maui","maui county"].includes(place) && event.source === "National Weather Service" &&
      Array.isArray(event.origin?.counties) && event.origin.counties.includes("015009")) return "local";
  const escaped = place.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  if (place.length > 1 && new RegExp("(^|[^\\p{L}\\p{N}])" + escaped + "(?=$|[^\\p{L}\\p{N}])", "u").test(text)) return "local";
  if (
    place === "maui" &&
    /\b(lahaina|kahului|wailuku|kihei|kula|molokai|lanai)\b/.test(text)
  )
    return "local";
  return event.scope === "local" ? "us" : event.scope;
}
export function ranked(event, now, location) {
  const hours = Math.max(0, (now - Date.parse(event.updatedAt)) / HOUR);
  const rankReasons = [];
  let rank = Math.max(0, 48 - hours);
  if (hours <= 24) rankReasons.push(event.observedAt ? "Discovered by GDELT within 24 hours" : "Source updated within 24 hours");
  if (event.severity === "high" || event.severity === "moderate") {
    rank += event.severity === "high" ? 48 : 20;
    rankReasons.push(event.severityReason || "Elevated source severity");
  }
  const growth = event.timeline.filter(
    (t) =>
      t.text.startsWith("Additional coverage indexed") &&
      now - Date.parse(t.at) < DAY,
  ).length;
  if (growth > 0) {
    rank += Math.min(16, growth * 4);
    rankReasons.push(growth + " additional coverage update(s) in 24h");
  }
  if (event.interest > 0) {
    rank += Math.min(12, Math.log2(event.interest + 1));
    rankReasons.push(event.interest + " " + event.interestType);
  }
  if (!rankReasons.length) rankReasons.push(event.observedAt ? "Ordered by discovery time" : "Ordered by latest source update");
  return {
    ...event,
    rank: Math.round(rank),
    rankReasons,
    scope: scopeFor(event, location),
  };
}
export const validId = (id) =>
  typeof id === "string" && /^\d{4}-\d{2}-\d{2}-[a-f0-9]{20}$/.test(id);
