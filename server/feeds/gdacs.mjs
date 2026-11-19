import { XMLParser, XMLValidator } from "fast-xml-parser";
import { DAY, date, plain } from "./model.mjs";

const source = "Global Disaster Awareness and Coordination System, GDACS";
const hazards = { TC:"Tropical cyclone", FL:"Flood", WF:"Wildfire", VO:"Volcanic activity", DR:"Drought" };
const levels = new Set(["orange","red"]);
const xml = new XMLParser({ignoreAttributes:true, parseTagValue:false, trimValues:true});

// The official RSS records use stable GDACS event keys and a separate episode key per revision.
function keyFor(item) {
  const type = String(item["gdacs:eventtype"] || "").toUpperCase();
  const eventId = String(item["gdacs:eventid"] || "");
  const episodeId = String(item["gdacs:episodeid"] || "");
  if (!Object.hasOwn(hazards,type) || !/^\d{1,12}$/.test(eventId) || !/^\d{1,12}$/.test(episodeId)) return null;
  try {
    const link = new URL(item.link);
    if (!["http:","https:"].includes(link.protocol) || link.username || link.password || link.port ||
        !["gdacs.org","www.gdacs.org"].includes(link.hostname) || link.pathname.toLowerCase() !== "/report.aspx" ||
        link.searchParams.get("eventtype") !== type || link.searchParams.get("eventid") !== eventId) return null;
  } catch { return null; }
  return {type,eventId,episodeId,url:"https://www.gdacs.org/report.aspx?eventtype="+type+"&eventid="+eventId};
}

function coordinates(item) {
  const point = item["geo:Point"];
  const pair = typeof item["georss:point"] === "string" ? item["georss:point"].trim().split(/\s+/) : [point?.["geo:lat"],point?.["geo:long"]];
  if (pair.length !== 2 || !pair.every(value => typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))) return null;
  const [lat,lon] = pair.map(Number);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon,lat] : null;
}

function rowFor(item, key, now) {
  const level = String(item["gdacs:alertlevel"] || "").toLowerCase();
  const episodeLevel = String(item["gdacs:episodealertlevel"] || "").toLowerCase();
  if (String(item["gdacs:iscurrent"]).toLowerCase() !== "true" || String(item["gdacs:temporary"]).toLowerCase() === "true" ||
      !levels.has(level) || !levels.has(episodeLevel)) return null;
  const publishedAt = date(item.pubDate || item["gdacs:dateadded"]);
  const revised = date(item["gdacs:datemodified"]);
  const from = Date.parse(item["gdacs:fromdate"]);
  const to = Date.parse(item["gdacs:todate"]);
  if (!publishedAt || !revised || !Number.isFinite(from) || !Number.isFinite(to) ||
      from > now || to < from || Date.parse(revised) > now + 300000 || Date.parse(publishedAt) > now + 300000) return null;
  const updatedAt = revised > publishedAt ? revised : publishedAt;
  const rawExpiry = item["gdacs:expires"] || item.expires;
  const expiresAt = rawExpiry ? date(rawExpiry) : null;
  if (rawExpiry && (!expiresAt || Date.parse(expiresAt) <= now)) return null;
  // "todate" may be the latest observation: a current cyclone bulletin can be issued
  // later on that same day. The display horizon is local editorial freshness, never
  // advertised as a publisher's expiry or as a forecast of the event's physical end.
  const freshUntil = Math.min((Math.floor(to / DAY) + 1) * DAY, Date.parse(updatedAt) + 4 * DAY,
    expiresAt ? Date.parse(expiresAt) : Infinity);
  if (freshUntil <= now) return null;
  const countries = [...new Set(plain(item["gdacs:country"],250).split(",").map(country=>country.trim()).filter(Boolean))];
  const location = countries.join(", ");
  const name = key.type === "TC" ? plain(item["gdacs:eventname"],55) : "";
  const title = hazards[key.type] + (name ? " " + name : "") + (location ? " in " + location : "") + " · GDACS " + episodeLevel + " alert";
  const levelLabel = episodeLevel === "red" ? "Red" : "Orange";
  const summary = "GDACS classifies the current " + hazards[key.type].toLowerCase() + " episode as " + levelLabel +
    " for potential humanitarian impact." + (level !== episodeLevel ? " The overall event class is " + level + "." : "");
  return {
    title,summary,source,url:key.url,category:"Natural event",natural:true,coords:coordinates(item),location,
    scope:countries.length === 1 && /^(united states(?: of america)?|puerto rico|guam|american samoa|u\.?s\.? virgin islands)$/i.test(countries[0]) ? "us" : "global",
    publishedAt,updatedAt,expiresAt,status:"confirmed",severity:episodeLevel === "red" ? "high" : "moderate",
    severityReason:"GDACS " + levelLabel + " humanitarian impact alert",
    originLabel:"GDACS published its assessment.",
    gdacs:{type:key.type,eventId:key.eventId,episodeId:key.episodeId,level:episodeLevel,overallLevel:level,
      observationTo:new Date(to).toISOString(),freshUntil:new Date(freshUntil).toISOString()},
  };
}

export function gdacs(input, now = Date.now()) {
  if (typeof input !== "string" || Buffer.byteLength(input,"utf8") > 2100000 || /<!DOCTYPE|<!ENTITY/i.test(input)) throw new Error("Unsupported GDACS feed");
  const body = input.replace(/^\uFEFF/,"").trimStart();
  if (XMLValidator.validate(body) !== true) throw new Error("Invalid GDACS XML");
  const channel = xml.parse(body)?.rss?.channel;
  if (!channel || !/GDACS/i.test(channel.title || "")) throw new Error("Invalid GDACS RSS channel");
  const items = [channel.item || []].flat();
  if (items.length > 1200) throw new Error("Oversized GDACS item set");
  const latest = new Map();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const key = keyFor(item);
    if (!key) continue;
    const revised = date(item["gdacs:datemodified"]);
    if (!revised || Date.parse(revised) > now + 300000) continue;
    const row = rowFor(item,key,now);
    const prior = latest.get(key.url);
    const episode = Number(key.episodeId);
    // Newer green, inactive or expired episodes supersede older colored entries.
    if (!prior || revised > prior.revised || (revised === prior.revised &&
        (episode > prior.episode || (episode === prior.episode && !row)))) {
      latest.set(key.url,{revised,episode,row});
    }
  }
  return [...latest.values()].flatMap(entry => entry.row ? [entry.row] : [])
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt) || a.url.localeCompare(b.url));
}
