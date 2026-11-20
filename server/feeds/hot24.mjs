import { DAY, HOUR, fold, scopeFor, validId } from "./model.mjs";
import { narrativeHot } from "./detection.mjs";

const inDay = (value, now) => {
  const time = Date.parse(value || "");
  return Number.isFinite(time) && time <= now && now - time < DAY;
};
const dated = (time, reason) => ({ time, reason });
const safetyNotice = /\b(boil water|drinking water|public safety|evacuat\w*|watch for official|ballot.related|power supply|power outage|water service|road closure|wildfire|flash flood|emergency|tsunami|public health|election results|recount|recall|restores? service)\b/i;
const civicChange = /\b(signs? into law|court (?:orders?|blocks?|strikes down|overturns?)|emergency (?:order|declaration)|election (?:result|certifi|disput)|regulat(?:or|ors) (?:orders?|interven\w*)|sanctions|ceasefire|humanitarian|displace\w*|peace talks|aid (?:access|delivery)|outbreak|suspends? (?:operations|service)|economic (?:crisis|shock)|bank (?:run|failure)|state of emergency)\b/i;
const internationalChange = /\b(?:genocide (?:ruling|verdict)|international (?:court|tribunal) (?:rules|orders|finds)|(?:trilateral|bilateral|peace|diplomatic) summit|summit (?:concludes|ends|agreement|was|opens)|(?:imposes?|lifts?|tightens?) (?:economic |international )?sanctions)\b/i;
const retrospective = /\b(?:anniversary|memories of|memory of|remembering|years? ago|guide to|looking back)\b/i;
const unusual = /\b(aviation (?:accident|incident)|(?:aircraft|plane|passenger jet|helicopter) crash(?:es|ed)?|unexplained (?:outage|event|phenomen\w*)|undersea cable (?:break|cut|damage)|satellite (?:anomaly|failure)|mass stranding)\b/i;
const operational = /\b(proof[- ]of[- ]concept|exploit code|troop positions|strike coordinates)\b/i;

// The collector's first-seen timestamp is not a publisher date. An older
// article needs both a recent source clock and an identifiable material change.
export function hotEdition(e, now) {
  if (e.observedAt || operational.test(e.title) || (e.expiresAt && Date.parse(e.expiresAt) <= now)) return null;
  const changes = (e.observations?.changes || []).filter(c => inDay(c.at, now));
  if (inDay(e.updatedAt, now) && e.updatedAt > e.publishedAt) {
    const change = changes.findLast(c => ["escalation","correction","coverage"].includes(c.kind));
    if (change) return dated(e.updatedAt, change.description);
    // Conservative support for editorial/article revisions without a signal escalation.
    // Require an actual two-edition comparison as well as a publisher-supplied update date.
    const edits = (e.timeline || []).filter(t => inDay(t.at, now));
    const prior = edits.findLast(t => t.text.startsWith("Prior edition: "));
    const revision = prior && edits.some(t => t.at === prior.at && t.text.startsWith("Source revision: "));
    if (revision) {
      const words = text => new Set(fold(text).match(/[\p{L}\p{N}]{3,}/gu) || []);
      const previous = words(prior.text.slice("Prior edition: ".length));
      const current = words(e.title + " " + (e.summary || ""));
      const added = [...current].filter(w => !previous.has(w)).length;
      if (added >= 6 && added / Math.max(1, current.size) >= .15)
        return dated(e.updatedAt, "The publisher revised the report with substantively different text.");
    }
  }
  if (inDay(e.publishedAt, now)) return dated(e.publishedAt, "Published within the last 24 hours.");
  return null;
}

function coverageValue(e, assessment, narrative, scope, now, edition) {
  const reasons = [edition.reason];
  let weight = 0;
  if (assessment) {
    // The signal score already includes source credibility, impact, urgency, proximity and acceleration.
    weight = assessment.score;
    reasons.push(assessment.why);
    const change = e.observations?.changes?.findLast(c => c.kind === "escalation" && inDay(c.at, now));
    if (change && change.description !== edition.reason) reasons.push(change.description);
  } else if (e.transient || e.source === "Reddit") {
    if (!e.transient || e.status !== "speculation" || !e.topicClaim || e.interestType !== "public discussion comments" || !(e.interest >= 10)) return null;
    weight = 15 + Math.min(12, Math.log2(1 + e.interest));
    reasons.push(e.interest + " public discussion comments. This measures attention to the claim.");
  } else if (narrative || e.topicClaim) {
    if (e.status === "speculation" || e.editorialType === "prediction") return null;
    const records = e.source && e.sources?.some(s => s.url && s.name);
    if (!records) return null;
    weight = narrative ? 51 : e.editorialType === "investigation" || e.category === "Fact check" || e.category === "Public record" ? 34 : 24;
    reasons.push(...(narrative?.rankReasons || ["Source-linked reporting about a tracked claim. The claim retains its own verification status."]));
  } else if (e.status === "speculation" || e.editorialType === "prediction") {
    return null;
  } else if (e.source === "National Weather Service" || e.source === "USGS" || e.source === "NASA EONET" || e.gdacs) {
    // Routine global measurements and expired warnings do not crowd out developments.
    if (e.source === "USGS" && Number.isFinite(e.origin?.magnitude) && (e.origin.magnitude >= 5 || scope === "local" && e.origin.magnitude >= 3.5 || e.interest >= 50)) {
      weight = 32 + Math.min(10, Math.max(0, e.origin.magnitude - 4) * 3);
      reasons.push("USGS reports magnitude " + e.origin.magnitude + (e.interest > 0 ? " and " + e.interest + " felt reports." : "."));
    } else if (e.source === "National Weather Service" && scope === "local" && e.expiresAt && e.origin?.certainty !== "Unlikely" && /\badvisory\b/i.test(e.origin?.event || "")) {
      weight = 34;
      reasons.push("An official local advisory is still in force.");
    } else return null;
  } else {
    const regional = scope === "local" || /\bhawaii\b/.test(fold(e.location));
    if (regional && safetyNotice.test(e.title)) {
      weight = 44;
      reasons.push("The regional source reports a public-service or safety development.");
    } else if (unusual.test(e.title)) {
      weight = 45;
      reasons.push("The report describes an unusual event with potential public consequences.");
    } else if (civicChange.test(e.title) || internationalChange.test(e.title)) {
      weight = 42;
      reasons.push("The report concerns a change in public institutions, services or civilian conditions.");
    } else if (!retrospective.test(e.title) && (e.category === "Conflict reporting" || e.category === "Emergency reporting" || e.category === "UN press bulletin" || e.category === "World" || e.editorialType === "investigation")) {
      weight = 28;
      reasons.push("Current " + (e.editorialType === "investigation" ? "source-linked investigation" : e.category.toLowerCase() + " coverage") + " from " + e.source + ".");
    } else return null;
    if (e.status === "confirmed" && /(?:^|\.)gov$/i.test(new URL(e.url).hostname)) {
      weight += 5;
      reasons.push("The issuing government source published the record.");
    }
  }
  if (scope === "local") {
    weight += assessment ? 6 : 11;
    reasons.push("Matches the selected local area.");
  } else if (/\bhawaii\b/.test(fold(e.location))) {
    weight += 4;
    reasons.push("The source places the event in Hawaiʻi.");
  }
  if (assessment?.axes?.acceleration) reasons.push("Measured change or attention raised its signal score.");
  const recency = 8 * (1 - (now - Date.parse(edition.time)) / DAY);
  return { rank: Math.round(weight + recency), rankReasons: [...new Set(reasons)] };
}
export function buildHot24(candidates, scored, now, location, collapse) {
  const scoredById = new Map(scored.map(e => [e.id, e]));
  const pool = [];
  const seen = new Set();
  for (const e of candidates) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const edition = hotEdition(e, now);
    if (!edition) continue;
    const assessed = scoredById.get(e.id);
    const scope = assessed?.scope || scopeFor(e, location);
    const narrative = e.topicClaim ? narrativeHot(e, now, location) : null;
    const score = coverageValue(e, assessed?.intelligence, narrative, scope, now, edition);
    if (score) pool.push({ ...(assessed || e), ...score, scope, hotAt: edition.time, ...(e.topicClaim ? {narrativeTrend:true} : {}) });
  }
  pool.sort((a,b) => b.rank - a.rank || b.hotAt.localeCompare(a.hotAt) || a.id.localeCompare(b.id));
  const rows = collapse(pool);
  const selected = [], editionCounts = new Map();
  // Downweight repeated lower-priority reports from the same desk and type within the lead page.
  // Two high-priority items from the same desk retain full weight. Later repetitions
  // leave room for a comparable regional development. All records remain pageable.
  const group = e => e.source + "|" + (e.intelligence?.topic || e.category);
  const adjusted = e => {
    const repeated = editionCounts.get(group(e)) || 0;
    const penalty = e.intelligence?.level === "high" ? Math.min(22, 11 * Math.max(0, repeated - 1)) : Math.min(36, 12 * repeated);
    return e.rank - penalty;
  };
  while (rows.length && selected.length < 16) {
    let best = 0;
    for (let i = 1; i < rows.length; i++) if (adjusted(rows[i]) > adjusted(rows[best])) best = i;
    const [next] = rows.splice(best, 1);
    selected.push(next);
    const key = group(next);
    editionCounts.set(key, (editionCounts.get(key) || 0) + 1);
  }
  return [...selected, ...rows];
}

// Day buckets already hold durable records; keep only small pointers for editions
// which rotated out of a provider's live result window. Withdrawn alerts and
// permissioned social content use the live feed exclusively.
export function previousHotMembers(state, defs, now) {
  const enabled = defs.filter(d => !d.disabled && !d.transient);
  const owners = new Map();
  for (const d of enabled) for (const id of state.providers[d.id]?.ids || []) {
    const ids = owners.get(id) || [];
    ids.push(d.id);
    owners.set(id, ids);
  }
  const index = new Map((state.hotArchive || []).map(pointer => [pointer.id, pointer]));
  for (const e of state.events) {
    if (e.transient || e.expiresAt || e.source === "National Weather Service" || !owners.has(e.id)) continue;
    const edition = hotEdition(e, now);
    if (edition) index.set(e.id, { id:e.id, at:edition.time, providers:owners.get(e.id) });
  }
  return [...index.values()];
}
export function retiredHotMembers(previous, activeIds, defs, now) {
  const enabled = new Set(defs.filter(d => !d.disabled && !d.transient).map(d => d.id));
  return previous.filter(p => validId(p.id) && !activeIds.has(p.id) && inDay(p.at, now) && p.providers?.some(id => enabled.has(id)))
    .sort((a,b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, 1000);
}
export async function readRetiredHot(index, activeIds, defs, now, readDay) {
  const byDay = new Map();
  for (const p of retiredHotMembers(index || [], activeIds, defs, now)) {
    const day = p.id.slice(0, 10);
    const wanted = byDay.get(day) || new Set();
    wanted.add(p.id);
    byDay.set(day, wanted);
  }
  const result = [];
  const days = [...byDay.keys()];
  for (let start = 0; start < days.length; start += 8) {
    const buckets = await Promise.all(days.slice(start, start + 8).map(async day => {
      const records = await readDay(day);
      return (records || []).filter(e => byDay.get(day).has(e.id) && !e.transient && !e.expiresAt);
    }));
    result.push(...buckets.flat());
  }
  return result;
}
