import { digest } from "./http.mjs";
import { groundedAnswer } from "./answer.mjs";
import { reportRecord, sourceCandidate } from "./evidence.mjs";

export const DEFAULT_LOCATION = "Maui";
export const HOUR = 3600000;
const categories = ["whatHappened", "whyItMatters", "whatToMonitor"];
const emptySections = () => ({ whatHappened:[], whyItMatters:[], whatToMonitor:[] });
const clipped = (value, max = 340) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
const point = (text, record) => ({text:clipped(text), citationIds:[record.id]});
const stripToCitation = ({id, eventId, title, source, url, publishedAt, scope}) => ({id,eventId,title,source,url,publishedAt,scope});
const confirmedPublic = event => sourceCandidate(event) && !event.topicClaim && event.status !== "speculation" && event.editorialType !== "prediction";
const version = record => digest(JSON.stringify([record.eventId,record.title,record.excerpt,record.status,record.updatedAt,record.expiresAt,record.url]));
const isRecent = (record, now) => now - Date.parse(record.updatedAt || record.publishedAt) <= 7 * 24 * HOUR &&
  (!record.expiresAt || Date.parse(record.expiresAt) > now);

export async function briefingMaterial(search, location, now) {
  const signals = await search({view:"signals",location,scope:"all",limit:200});
  const qualifies = event => confirmedPublic(event) && isRecent(event, now) &&
    Number.isFinite(event.intelligence?.score) && event.intelligence.score >= 40 &&
    ["watch","elevated","high"].includes(event.intelligence.level);
  const candidates = new Map(signals.events.filter(qualifies).map(event => [event.id,event]));
  if (signals.nextCursor) {
    // A busy hazard day can crowd a region off the first global page.
    const present = new Set([...candidates.values()].map(event => event.scope));
    const missing = ["local","us","global"].filter(scope => !present.has(scope));
    const pages = await Promise.all(missing.map(scope => search({view:"signals",location,scope,limit:8})));
    for (const page of pages) {
      for (const event of page.events.filter(qualifies)) candidates.set(event.id,event);
    }
  }
  const pool = [...candidates.values()];
  const selected = [];
  for (const scope of ["local","us","global"]) {
    const regional = pool.filter(event => event.scope === scope).sort((a,b) =>
      b.intelligence.score - a.intelligence.score ||
      String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.id.localeCompare(b.id));
    if (!regional.length) continue;
    selected.push(regional[0]);
    const second = regional.find(event => event.id !== regional[0].id && event.source !== regional[0].source);
    if (second) selected.push(second);
  }
  const records = selected.map((event,index) => ({ ...reportRecord(event), id:String(index + 1) }));
  // Exclude continuously changing polling timestamps and low-order rank fluctuations.
  const leads = records.map(record => [version(record),record.signal.level]).sort((a,b) => a[0].localeCompare(b[0]));
  const high = pool.filter(event => event.intelligence.level === "high")
    .map(event => [event.id,event.intelligence.changeKey || "",event.intelligence.level]).sort((a,b) => a[0].localeCompare(b[0]));
  const fingerprint = digest(JSON.stringify({leads,high}));
  return {location,records,fingerprint,updatedAt:signals.updatedAt || null,
    versions:new Map(pool.map(event => [event.id,version(reportRecord(event))]))};
}

function briefNotice(material, message) {
  return material.records.some(record => record.scope === "local") ? message :
    "No qualifying local signal for " + material.location + " in the available scan. " + message;
}

export function fallbackBrief(material, now, notice) {
  const sections = emptySections();
  const leads = ["local","us","global"].map(scope => material.records.find(row => row.scope === scope)).filter(Boolean);
  for (const record of leads) sections.whatHappened.push(point(record.title, record));
  for (const record of leads.slice(0,2)) {
    if (record.signal?.why) sections.whyItMatters.push(point(record.signal.why, record));
    else if (record.excerpt && record.excerpt !== record.title) sections.whyItMatters.push(point(clipped(record.excerpt, 260), record));
    const monitor = record.signal?.monitor || (record.expiresAt
      ? "Check " + record.source + " for updates before the published expiry at " + record.expiresAt + "."
      : "Check for a revision from " + record.source + " to “" + clipped(record.title, 120) + "”.");
    sections.whatToMonitor.push(point(monitor, record));
  }
  return { location:material.location,mode:"sources",generatedAt:null,updatedAt:material.updatedAt,
    stale:!material.updatedAt || now - Date.parse(material.updatedAt) > HOUR,
    notice:briefNotice(material, leads.length ? notice || "Source briefing from the current qualifying signals." : "No qualifying signals in the available seven-day reporting window."),
    sections,citations:leads.map(stripToCitation) };
}

export function validateSituation(raw, records) {
  const sections = emptySections();
  const used = new Set();
  for (const name of categories) {
    const paragraphs = raw?.[name];
    if (!Array.isArray(paragraphs) || !paragraphs.length || paragraphs.length > 2) return null;
    for (const paragraph of paragraphs) {
      if (!paragraph || (paragraph.text?.length ?? 0) > 340) return null;
      const result = groundedAnswer({ paragraphs:[paragraph] }, records);
      if (!result) return null;
      const citationIds = result.citations.map(item => records.find(record => record.url === item.url).id);
      citationIds.forEach(id => used.add(id));
      sections[name].push({text:clipped(paragraph.text),citationIds});
    }
  }
  return {sections,citations:records.filter(record => used.has(record.id)).map(stripToCitation)};
}

export function cachedBrief(entry, material, now) {
  if (!entry?.brief || !entry.versions?.length || now - Date.parse(entry.checkedAt || entry.brief.generatedAt) > 12 * HOUR) return null;
  if (material && material.fingerprint !== entry.fingerprint) return null;
  for (const row of entry.versions) {
    if (row.expiresAt && Date.parse(row.expiresAt) <= now) return null;
    if (material && material.versions.get(row.eventId) !== row.version) return null;
  }
  return {...entry.brief, updatedAt:material?.updatedAt || entry.brief.updatedAt,
    stale:!material || !material.updatedAt || now - Date.parse(material.updatedAt) > HOUR,
    notice:material ? briefNotice(material,"Scheduled AI briefing from the cited reports.") : "Showing the last saved briefing while the reporting store is unavailable."};
}
export function makeEntry(brief, material, timestamp) {
  const ids = new Set(brief.citations.map(row => row.eventId));
  return { schema:1, checkedAt:timestamp, fingerprint:material.fingerprint, brief,
    versions:material.records.filter(record => ids.has(record.eventId)).map(record => ({eventId:record.eventId, version:version(record), expiresAt:record.expiresAt})) };
}
